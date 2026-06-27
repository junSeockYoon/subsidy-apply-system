# 대국민 선착순 금융 지원금 신청 및 대용량 관리자 집계 시스템

Node.js 기반 고트래픽 선착순 처리 + 대용량 엑셀 스트리밍 다운로드 시스템 (포트폴리오용)

## Tech Stack

| 구분 | 기술 |
|------|------|
| Runtime | Node.js 20+, Express.js, PM2 |
| Database | MySQL 8 (Sequelize ORM) |
| Cache & Queue | Redis 7, BullMQ |
| 부하 테스트 | k6 (Step 5) |

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │         API Server (PM2 cluster)     │
                    │  Express — 짧은 요청/응답만 처리    │
                    └──────────┬──────────────┬───────────┘
                               │              │
                    ┌──────────▼──┐    ┌──────▼──────┐
                    │    Redis     │    │   MySQL     │
                    │ 대기열/Redlock│    │  영속 저장   │
                    └──────────────┘    └──────┬──────┘
                                               │
                    ┌──────────────────────────▼──────────┐
                    │      Worker Process (PM2 fork)       │
                    │  BullMQ → MySQL Stream → Excel 생성   │
                    └─────────────────────────────────────┘
```

---

## Step별 진행 현황

| Step | 내용 | 상태 |
|------|------|------|
| **Step 1** | 디렉터리 구조 + 패키지 + 인프라 설정 | ✅ 완료 |
| **Step 2** | Express 보일러플레이트 + MySQL/Redis 연결 | ⏳ 대기 |
| **Step 3** | Flow 1 — 선착순 API (good/bad 비교) | ⏳ 대기 |
| **Step 4** | Flow 2 — BullMQ + 엑셀 스트리밍 워커 | ⏳ 대기 |
| **Step 5** | k6 부하 테스트 스크립트 | ⏳ 대기 |

---

## Step 1 — 프로젝트 구조 및 패키지 설치 ✅

### 목표

- API 서버와 워커 프로세스를 **물리적으로 분리**할 수 있는 디렉터리 골격 확립
- 성능 최적화에 필요한 패키지 선정 및 설치
- 로컬 개발용 MySQL + Redis 인프라 정의

### 작성한 내용

#### 1) 디렉터리 구조

```
subsidy-apply-system/
├── src/
│   ├── api/                    # HTTP 요청 처리 (가벼운 I/O만)
│   │   ├── server.ts           # API 진입점
│   │   ├── app.ts              # Express 앱 조립
│   │   ├── routes/             # 라우터 (apply, export)
│   │   └── middlewares/        # 에러 핸들러 등
│   ├── worker/                 # 백그라운드 작업 (엑셀 생성)
│   │   ├── worker.ts
│   │   └── processors/
│   ├── services/               # 비즈니스 로직
│   │   ├── apply/              # good(Redis) / bad(DB) 분리
│   │   └── export/
│   ├── models/                 # Sequelize 모델
│   ├── lib/                    # Redis 클라이언트, Redlock, 로거
│   ├── config/                 # DB/Redis/BullMQ 설정
│   └── types/                  # 공통 TypeScript 타입
├── scripts/
│   ├── seed.ts                 # 더미 데이터 시드 (Step 2 이후)
│   └── k6/                     # 부하 테스트 (Step 5)
├── storage/exports/            # 생성된 엑셀 저장 (git 제외)
├── docker-compose.yml          # 로컬 MySQL + Redis
├── ecosystem.config.js         # PM2 cluster/fork 설정
├── package.json
├── tsconfig.json
└── .env.example
```

**왜 이렇게 나눴는가?**

| 레이어 | 성능상 이점 |
|--------|-------------|
| `api/` vs `worker/` | 엑셀 생성 같은 무거운 작업이 API 이벤트 루프를 막지 않음 |
| `services/apply/good` vs `bad` | 동일 도메인의 두 구현을 분리해 k6로 성능 비교 가능 |
| `lib/redis/` | Redis 연결·락·대기열을 한곳에 모아 재사용, 커넥션 낭비 방지 |
| `storage/exports/` | 스트리밍으로 디스크에 직접 쓰기 → 메모리에 파일 전체를 올리지 않음 |

#### 2) `package.json` — 핵심 패키지 선정 이유

| 패키지 | 역할 | 성능 최적화 포인트 |
|--------|------|-------------------|
| `express` | HTTP 서버 | 경량, 미들웨어 체인으로 요청 파이프라인 구성 |
| `sequelize` + `mysql2` | ORM + 드라이버 | 커넥션 풀 재사용, `mysql2`는 **Stream 조회** 지원 (OOM 방지) |
| `ioredis` | Redis 클라이언트 | 파이프라인·Lua 스크립트 지원, 고속 인메모리 처리 |
| `redlock` | 분산 락 | 잔여 수량 동시 차감 시 race condition 방어 |
| `bullmq` | Job Queue | API는 enqueue만 → 202 즉시 응답, 워커가 비동기 처리 |
| `exceljs` | 엑셀 생성 | StreamWriter로 행 단위 쓰기 → 대용량 파일도 OOM 없음 |
| `pino` | 로깅 | `console.log` 대비 5~10배 빠른 구조화 로깅 |
| `zod` | 입력 검증 | 잘못된 요청을 DB/Redis 도달 전에 조기 차단 |
| `tsx` | TS 실행 | 빌드 없이 개발 서버 즉시 실행 |

#### 3) `ecosystem.config.js` — PM2 프로세스 분리

```js
// API: cluster 모드 — CPU 코어 수만큼 인스턴스 → 싱글 스레드 한계 극복
// Worker: fork 모드 1개 — 메모리 집약적 엑셀 작업 시 OOM 제어
```

#### 4) `docker-compose.yml` — 로컬 인프라

MySQL 8 + Redis 7을 한 번에 띄울 수 있도록 구성했습니다.
별도 DB 서버를 직접 설치·운영할 필요 없이, Docker만 있으면 됩니다.

#### 5) `.env.example` — 환경변수 템플릿

DB 접속 정보, Redis, 지원금 쿼터(10,000건), 엑셀 저장 경로 등을 정의합니다.

### Step 1 설치 명령어

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 파일 생성
cp .env.example .env

# 3. MySQL + Redis 컨테이너 실행 (Docker 필요)
docker compose up -d

# 4. 컨테이너 상태 확인
docker compose ps
```

---

## Step 2 — Express + DB/Redis 연결 (다음 단계) ⏳

### 목표

- Express HTTP 서버 부트스트랩 (`/health` 엔드포인트)
- Sequelize로 MySQL 연결 및 모델 정의
- ioredis 싱글톤 연결
- pino 구조화 로거 설정
- 환경변수 zod 검증

### 구현 예정 파일

| 파일 | 내용 |
|------|------|
| `src/config/index.ts` | zod로 `.env` 검증 |
| `src/config/database.ts` | Sequelize + 커넥션 풀 |
| `src/config/redis.ts` | ioredis 싱글톤 |
| `src/models/Application.ts` | 신청 내역 테이블 |
| `src/models/SubsidyProgram.ts` | 지원금 프로그램 테이블 |
| `src/api/app.ts` | Express 앱 (helmet, cors, pino-http) |
| `src/api/server.ts` | listen + graceful shutdown |
| `src/lib/logger.ts` | pino 로거 |

---

## Step 3 — 선착순 API (Flow 1) ⏳

### 목표

- `POST /api/apply/good` — Redis 대기열 + Redlock (권장)
- `POST /api/apply/bad` — DB 직행 (성능 비교용)
- 10만 동시 요청 시 1만 건 정확한 선착순 보장

---

## Step 4 — 엑셀 다운로드 (Flow 2) ⏳

### 목표

- `POST /api/export` — BullMQ에 Job enqueue, 202 Accepted 반환
- `GET /api/export/:jobId` — 생성 상태 조회 / 다운로드
- 워커: MySQL Stream → ExcelJS StreamWriter 파이프라인

---

## Step 5 — k6 부하 테스트 ⏳

### 목표

- `scripts/k6/apply-good.js` — Redis 버전 부하 테스트
- `scripts/k6/apply-bad.js` — DB 직행 버전 부하 테스트
- 동시 접속자·응답 시간·성공률 비교 리포트

---

## Step 2 시작 전 — 사용자가 준비할 것

### 필수 (반드시 필요)

| 항목 | 설명 | 확인 방법 |
|------|------|-----------|
| **Node.js 20+** | 런타임 | `node -v` |
| **npm** | 패키지 매니저 | `npm -v` |
| **Docker Desktop** | MySQL + Redis 로컬 실행 | `docker -v` |
| **`.env` 파일** | 환경변수 | `cp .env.example .env` 후 필요 시 수정 |
| **`npm install` 완료** | 의존성 설치 | `ls node_modules` |

### MySQL을 직접 제공해야 하나?

**아니요. 별도 MySQL 서버를 직접 설치·제공할 필요는 없습니다.**

이 프로젝트는 `docker-compose.yml`에 MySQL과 Redis가 이미 정의되어 있습니다.

```bash
docker compose up -d
```

위 명령 한 줄로 아래가 자동 생성됩니다.

| 항목 | docker-compose 기본값 |
|------|----------------------|
| DB 호스트 | `localhost` |
| DB 포트 | `3306` |
| DB 이름 | `subsidy_db` |
| DB 사용자 | `root` |
| DB 비밀번호 | `secret` |
| Redis 호스트 | `localhost` |
| Redis 포트 | `6379` |

`.env.example`의 값이 docker-compose와 일치하므로, **기본 설정 그대로 쓰면 추가 입력 없이 Step 2를 진행할 수 있습니다.**

#### Docker 대신 직접 MySQL을 쓰고 싶다면

아래 정보를 `.env`에 맞춰 알려주시면 됩니다.

```
DB_HOST=
DB_PORT=
DB_NAME=
DB_USER=
DB_PASSWORD=
```

로컬에 이미 MySQL이 3306 포트를 쓰고 있다면, docker-compose의 MySQL 포트를 바꾸거나 기존 MySQL을 사용하면 됩니다.

### 선택 (있으면 좋음, 없어도 Step 2 진행 가능)

| 항목 | 설명 |
|------|------|
| **도메인 요구사항 확인** | 지원금 쿼터 수(기본 10,000), 신청 필드(이름, 전화번호 등) 변경 여부 |
| **PM2** | 프로덕션 배포 시 필요 (`npm i -g pm2`), 로컬 개발에는 불필요 |
| **k6** | Step 5에서 필요 (`brew install k6`) |

### Step 2 시작 전 체크리스트

```bash
# 아래 명령을 순서대로 실행하고, 모두 성공하면 Step 2를 시작할 수 있습니다.

node -v          # v20 이상
npm -v
docker -v        # Docker 설치 확인

cp .env.example .env   # 아직 안 했다면
npm install

docker compose up -d
docker compose ps        # mysql, redis 모두 "running" 확인

# MySQL 접속 테스트 (선택)
docker exec -it subsidy-mysql mysql -uroot -psecret -e "SHOW DATABASES;"
# → subsidy_db 가 보이면 OK

# Redis 접속 테스트 (선택)
docker exec -it subsidy-redis redis-cli ping
# → PONG 이면 OK
```

위 체크리스트가 모두 통과되면, **별도로 DB 스키마나 데이터를 미리 넣을 필요 없이** Step 2에서 Sequelize가 테이블을 자동 생성(sync)합니다.

---

## API Endpoints (전체 로드맵)

| Method | Path | 설명 | Step |
|--------|------|------|------|
| GET | `/health` | 헬스체크 | Step 2 |
| POST | `/api/apply/good` | Redis + Redlock 선착순 (권장) | Step 3 |
| POST | `/api/apply/bad` | DB 직행 선착순 (비교용) | Step 3 |
| POST | `/api/export` | 엑셀 생성 요청 (202 Accepted) | Step 4 |
| GET | `/api/export/:jobId` | 생성 상태 / 다운로드 | Step 4 |

---

## 개발 명령어

```bash
npm run dev:api       # API 서버 (hot reload)
npm run dev:worker    # 워커 서버 (hot reload)
npm run build         # TypeScript → dist/
npm run start:api     # 프로덕션 API
npm run start:worker  # 프로덕션 워커
npm run start:pm2     # PM2로 API + Worker 동시 실행
npm run seed          # 더미 데이터 시드 (Step 2 이후)
```

## Load Test (Step 5)

```bash
k6 run scripts/k6/apply-good.js
k6 run scripts/k6/apply-bad.js
```
