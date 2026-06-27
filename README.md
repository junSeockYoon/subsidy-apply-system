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
| **Step 2** | Express 보일러플레이트 + MySQL/Redis 연결 | ✅ 완료 |
| **Step 3** | Flow 1 — 선착순 API (good/bad 비교) | ✅ 완료 |
| **Step 4** | Flow 2 — BullMQ + 엑셀 스트리밍 워커 | ✅ 완료 |
| **Step 5** | k6 부하 테스트 스크립트 | ✅ 완료 |

---

## 처음 시작하기 — Docker로 MySQL·Redis 띄우기 (초보자용)

> **결론부터:** DB를 직접 만들 필요 없습니다. `docker compose up -d` 한 줄이면 MySQL·Redis·DB 생성까지 끝납니다.

### Docker가 하는 일 (비유)

| 개념 | 비유 |
|------|------|
| **Docker** | 가상의 작은 컴퓨터를 통째로 띄우는 도구 |
| **이미지(image)** | 그 컴퓨터에 미리 설치된 OS+프로그램 스냅샷 (예: `mysql:8.0`) |
| **컨테이너(container)** | 실제로 실행 중인 인스턴스 |
| **docker-compose.yml** | MySQL + Redis를 한 번에 띄우는 설치 스크립트 |

우리 프로젝트의 `docker-compose.yml`이 아래를 **자동으로** 해줍니다.

- MySQL 8 설치 및 실행
- `subsidy_db` 데이터베이스 생성
- `root` / `secret` 계정 생성
- Redis 7 설치 및 실행

### Step-by-Step 실행 가이드

#### ① Docker Desktop 실행

Mac 상단 메뉴바에 고래 아이콘이 보여야 합니다. 없으면 **Docker Desktop** 앱을 실행하세요.

```bash
docker -v
# Docker version 27.x.x ... ← 나오면 OK
```

`Cannot connect to the Docker daemon` 오류가 나면 → Docker Desktop이 꺼져 있는 것입니다.

#### ② 프로젝트 폴더로 이동

```bash
cd subsidy-apply-system
```

#### ③ 환경변수 파일 확인

```bash
cp .env.example .env   # 이미 있으면 생략
```

`.env`의 DB/Redis 값은 docker-compose 기본값과 일치합니다. **수정할 필요 없습니다.**

#### ④ MySQL + Redis 컨테이너 실행

```bash
docker compose up -d
```

| 옵션 | 의미 |
|------|------|
| `up` | 컨테이너 생성 + 시작 |
| `-d` | 백그라운드(detached) 실행 — 터미널이 안 막힘 |

처음 실행 시 이미지 다운로드로 1~3분 걸릴 수 있습니다.

#### ⑤ 실행 확인

```bash
docker compose ps
```

| NAME | STATUS |
|------|--------|
| subsidy-mysql | running |
| subsidy-redis | running |

#### ⑥ (선택) MySQL·Redis 직접 확인

```bash
# MySQL — subsidy_db가 보이면 성공
docker exec -it subsidy-mysql mysql -uroot -psecret -e "SHOW DATABASES;"

# Redis — PONG이 나오면 성공
docker exec -it subsidy-redis redis-cli ping
```

#### ⑦ API 서버 실행

```bash
npm install          # 최초 1회
npm run dev:api
```

#### ⑧ 헬스체크

```bash
curl http://localhost:3000/health
```

성공 응답 예시:

```json
{
  "status": "ok",
  "mysql": "connected",
  "redis": "connected",
  "timestamp": "2026-06-27T..."
}
```

### 자주 쓰는 Docker 명령어

```bash
docker compose up -d      # 시작
docker compose ps         # 상태 확인
docker compose logs mysql # MySQL 로그 보기
docker compose stop       # 중지 (데이터 유지)
docker compose down       # 중지 + 컨테이너 삭제 (데이터는 volume에 유지)
docker compose down -v    # ⚠️ 데이터까지 전부 삭제 (초기화할 때만)
```

### 사용자가 전달해야 하는 것

| 필요 여부 | 항목 |
|-----------|------|
| ❌ 불필요 | MySQL 직접 설치 |
| ❌ 불필요 | DB 수동 생성 (`CREATE DATABASE ...`) |
| ❌ 불필요 | Redis 설치·설정 |
| ❌ 불필요 | 테이블 DDL 직접 작성 |
| ✅ 필요 | Docker Desktop 실행 |
| ✅ 필요 | `.env` 파일 (`cp .env.example .env`) |

서버가 처음 뜰 때 Sequelize가 테이블을 자동 생성하고, 기본 지원금 프로그램(1만 건)도 자동 등록됩니다.

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

## Step 2 — Express + DB/Redis 연결 ✅

### 목표

- Express HTTP 서버 부트스트랩 (`/health` 엔드포인트)
- Sequelize로 MySQL 연결 및 모델 정의
- ioredis 싱글톤 연결
- pino 구조화 로거 설정
- 환경변수 zod 검증

### 구현한 파일

| 파일 | 내용 | 성능 포인트 |
|------|------|-------------|
| `src/config/index.ts` | zod로 `.env` 검증 | 잘못된 설정으로 DB 타임아웃 대기 방지 |
| `src/config/database.ts` | Sequelize + 커넥션 풀 | TCP 연결 재사용 (`pool.max`) |
| `src/config/redis.ts` | ioredis 싱글톤 | 프로세스당 Redis 연결 1개 유지 |
| `src/models/SubsidyProgram.ts` | 지원금 프로그램 | 잔여 수량 관리 |
| `src/models/Application.ts` | 신청 내역 | `(program_id, user_id)` 유니크 인덱스 |
| `src/api/app.ts` | Express 앱 | helmet, pino-http, json 1mb 제한 |
| `src/api/server.ts` | listen + graceful shutdown | SIGTERM 시 커넥션 정리 |
| `src/lib/logger.ts` | pino 로거 | 고트래픽 저비용 로깅 |

### 자동으로 일어나는 일 (서버 첫 실행 시)

1. MySQL 연결 (`sequelize.authenticate`)
2. Redis 연결 (`ping`)
3. 테이블 자동 생성 (`subsidy_programs`, `applications`)
4. 기본 지원금 프로그램 등록 (쿼터 10,000건)
5. `GET /health` 엔드포인트 활성화

### 실행 확인

```bash
npm run dev:api
curl http://localhost:3000/health
```

성공 응답:

```json
{ "status": "ok", "mysql": "connected", "redis": "connected" }
```

### 자주 겪는 오류 (트러블슈팅)

| 오류 | 원인 | 해결 |
|------|------|------|
| `Access denied for user 'root'@'localhost'` | `.env`는 Docker 비밀번호(`secret`)인데 로컬 MySQL(3306)에 연결됨 | `DB_PORT=3307`, `docker compose up -d mysql` |
| `subsidy-mysql`이 `ps`에 없음 | 3306 포트 충돌로 MySQL 컨테이너 미기동 | 위와 동일 (3307 사용) |
| `EADDRINUSE :::3000` | API 서버가 이미 실행 중 | `curl localhost:3000/health` 확인 또는 `lsof -ti :3000 \| xargs kill` |

---

## Step 3 — 선착순 API (Flow 1) ✅

### 목표

- `POST /api/apply/good` — Redis + Redlock 선착순 (권장)
- `POST /api/apply/bad` — DB 직행 (성능 비교용 안티패턴)
- 10만 동시 요청 시 1만 건 정확한 선착순 보장 (Step 5 k6로 검증 예정)

### 비즈니스 규칙

| 규칙 | 설명 |
|------|------|
| 총 쿼터 | 10,000건 (`SUBSIDY_TOTAL_QUOTA`) |
| 중복 신청 | 동일 `userId`는 1회만 허용 |
| 마감 처리 | 잔여 0건 이후 신청은 `QUOTA_EXHAUSTED` |

### API 스펙

**요청**

```bash
POST /api/apply/good   # 또는 /api/apply/bad
Content-Type: application/json

{
  "userId": "user-001",
  "name": "홍길동",
  "phone": "01012345678"
}
```

**응답**

| 상황 | HTTP | body |
|------|------|------|
| 선착순 성공 | 201 | `{ "status": "success", "applicationId": 1 }` |
| 마감 | 409 | `{ "status": "failed", "reason": "QUOTA_EXHAUSTED" }` |
| 중복 신청 | 409 | `{ "status": "failed", "reason": "ALREADY_APPLIED" }` |
| 과부하 (good만) | 503 | `{ "status": "failed", "reason": "TOO_BUSY" }` |
| 입력 오류 | 400 | `{ "status": "failed", "reason": "VALIDATION_ERROR" }` |

### Good vs Bad 아키텍처 비교

```
[Bad API — DB 직행]
요청 → MySQL SELECT (잔여 확인) → INSERT → UPDATE
       ↑ race condition 구간 — 동시 요청 시 1만 건 초과 가능

[Good API — Redis + Redlock]
요청 → 동시처리 슬롯(50) → Redis 잔여량 fast-fail → Redis 중복 검사
     → Redlock → DECR 차감 → SET NX 중복 마킹 → MySQL INSERT
```

### 구현한 파일

| 파일 | 내용 | 성능·정합성 포인트 |
|------|------|-------------------|
| `src/lib/redis/queue.ts` | 잔여량 DECR, 중복 SET NX, 세마포어, 대기열 | DB 도달 전 μs 단위 거절·중복 차단 |
| `src/lib/redis/redlock.ts` | Redlock 분산 락 | 차감~INSERT 구간 race condition 방어 |
| `src/lib/redis/client.ts` | Redis 클라이언트 re-export | 커넥션 공유 |
| `src/services/apply/apply.good.service.ts` | Good 비즈니스 로직 | Redis 핫패스 + DB 영속화만 |
| `src/services/apply/apply.bad.service.ts` | Bad 비즈니스 로직 | 의도적 안티패턴 (k6 비교용) |
| `src/services/apply/types.ts` | 공통 타입 | — |
| `src/api/routes/apply.routes.ts` | 라우팅 + zod 검증 | 잘못된 요청 조기 차단 |
| `src/api/server.ts` | Redis 잔여량 초기화 (`initSubsidyRedis`) | 기동 시 `SET NX`로 카운터 준비 |

### Redis 키 구조

| 키 | 용도 |
|----|------|
| `subsidy:quota:{programId}` | 잔여 수량 (DECR 원자 연산) |
| `subsidy:applied:{programId}:{userId}` | 중복 신청 방지 (SET NX) |
| `subsidy:concurrent:{programId}` | 동시 DB 진입 제한 (세마포어, 최대 50) |
| `subsidy:queue:{programId}` | 요청 대기열 (LPUSH) |
| `subsidy:lock:{programId}` | Redlock 리소스 |

### 실행 확인

```bash
# Good — 성공
curl -X POST http://localhost:3000/api/apply/good \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user-001","name":"홍길동","phone":"01012345678"}'

# Good — 중복 (409)
curl -X POST http://localhost:3000/api/apply/good \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user-001","name":"홍길동","phone":"01012345678"}'

# Bad — 비교용
curl -X POST http://localhost:3000/api/apply/bad \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user-002","name":"김철수","phone":"01099998888"}'
```

### 데이터 초기화 (테스트 리셋)

```bash
# Redis + MySQL 데이터 초기화 후 재시작
docker compose down -v
docker compose up -d
npm run dev:api
```

---

## Step 4 — 엑셀 다운로드 (Flow 2) ✅

### 목표

- `POST /api/export` — BullMQ에 Job enqueue, **202 Accepted** 즉시 반환
- `GET /api/export/:jobId` — 생성 상태 조회
- `GET /api/export/:jobId/download` — 완료 시 파일 다운로드
- 워커: MySQL Stream → ExcelJS StreamWriter (OOM 방지)

### 아키텍처

```
관리자 → POST /api/export → API (202 즉시 응답)
                              ↓
                         BullMQ (Redis)
                              ↓
                    Worker 프로세스
                    mysql2 Stream 조회
                              ↓
                    ExcelJS StreamWriter
                              ↓
                    storage/exports/*.xlsx
```

### API 스펙

**엑셀 생성 요청**

```bash
curl -X POST http://localhost:3000/api/export \
  -H 'Content-Type: application/json' \
  -d '{"programId": 1, "requestedBy": "admin-001"}'
```

```json
// 202 Accepted
{ "jobId": "1", "status": "waiting", "message": "Export job queued" }
```

**상태 조회**

```bash
curl http://localhost:3000/api/export/1
```

```json
{
  "jobId": "1",
  "status": "completed",
  "result": {
    "fileName": "export-1-1.xlsx",
    "filePath": "./storage/exports/export-1-1.xlsx",
    "rowCount": 101000
  }
}
```

**다운로드**

```bash
curl -O -J http://localhost:3000/api/export/1/download
```

### 구현한 파일

| 파일 | 내용 | 성능 포인트 |
|------|------|-------------|
| `src/config/bullmq.ts` | BullMQ Redis 연결 | API ioredis와 분리 |
| `src/services/export/export.service.ts` | Job enqueue·상태 조회 | API는 큐에만 넣고 즉시 반환 |
| `src/api/routes/export.routes.ts` | export API 라우터 | 202 / 상태 / 다운로드 |
| `src/worker/worker.ts` | BullMQ Worker 진입점 | API와 프로세스 격리 |
| `src/worker/processors/export.processor.ts` | Stream 파이프라인 | 행 단위 읽기·쓰기로 OOM 방지 |
| `scripts/seed.ts` | 더미 데이터 시드 | bulkCreate 배치 삽입 |

### 실행 방법 (터미널 2개 필수)

```bash
# 터미널 1 — API
npm run dev:api

# 터미널 2 — Worker
npm run dev:worker
```

### 더미 데이터 시드

```bash
npm run seed           # 10만 건
npm run seed -- 50000  # 5만 건
npm run seed -- 100    # 100건 (빠른 테스트)
```

### OOM 방지 원리

| 나쁜 방식 | Step 4 방식 |
|-----------|-------------|
| `SELECT *` 전체 로드 → 메모리 배열 | `mysql2 .stream()` 행 단위 읽기 |
| 엑셀 전체 메모리 생성 | `WorkbookWriter` 디스크 스트리밍 |
| API에서 동기 처리 | BullMQ Worker 비동기 처리 |

---

## Step 5 — k6 부하 테스트 ✅

### 목표

- `scripts/k6/apply-good.js` — Redis + Redlock Good API 부하 테스트
- `scripts/k6/apply-bad.js` — DB 직행 Bad API 부하 테스트
- 동시 접속자·응답 시간·성공 건수 비교로 Step 3 설계 검증

### 사전 준비

```bash
# k6 설치 (macOS)
brew install k6

# 버전 확인
k6 version
```

### 부하 테스트 전체 흐름

```bash
# 1) 인프라 + API 서버 실행
docker compose up -d
npm run dev:api

# 2) 테스트 환경 초기화 (쿼터 10,000건 복원)
npm run loadtest:reset

# 3) Good API 부하 테스트
npm run loadtest:good:smoke    # 빠른 검증 (~100 VU)
# npm run loadtest:good         # standard 프로필 (K6_PROFILE=standard)

# 4) 환경 다시 초기화 후 Bad API 비교
npm run loadtest:reset
npm run loadtest:bad:smoke
```

> **Good vs Bad 비교 시** 반드시 `loadtest:reset`으로 초기화한 뒤 각각 실행하세요.

### 프로필 (K6_PROFILE)

| 프로필 | 최대 VU | 용도 |
|--------|---------|------|
| `smoke` (기본) | 100 | 로컬 빠른 검증 |
| `standard` | 5,000 | 중간 부하 비교 |
| `stress` | 100,000 | 포트폴리오 목표 시나리오 (고사양 PC/클라우드 권장) |

```bash
K6_PROFILE=standard npm run loadtest:good
K6_PROFILE=stress npm run loadtest:bad
```

### 커스텀 메트릭

| 메트릭 | 의미 |
|--------|------|
| `apply_success` | 선착순 성공 (201) |
| `apply_quota_exhausted` | 마감 (409 QUOTA_EXHAUSTED) |
| `apply_too_busy` | 과부하 거절 (503, good만) |
| `apply_http_errors` | 기타 HTTP 오류 |

### 결과 파일

테스트 완료 후 JSON 요약이 저장됩니다.

```
scripts/k6/results/summary-good.json
scripts/k6/results/summary-bad.json
```

### good vs bad 예상 비교 (면접용)

| 지표 | good (Redis) | bad (DB 직행) |
|------|----------------|---------------|
| p95 응답 시간 | 낮음 | 높음 |
| `apply_success` | ≤ 10,000 (정합) | 10,000 초과 가능 |
| `apply_http_errors` | 낮음 | 높음 (커넥션 풀 고갈) |
| DB 부하 | INSERT 위주 | SELECT+INSERT+UPDATE 폭증 |

### 구현 파일

| 파일 | 내용 |
|------|------|
| `scripts/k6/lib.js` | 공통 시나리오·메트릭·요청 헬퍼 |
| `scripts/k6/apply-good.js` | Good API k6 스크립트 |
| `scripts/k6/apply-bad.js` | Bad API k6 스크립트 |
| `scripts/reset-load-test.ts` | 쿼터·Redis·테이블 초기화 |

### npm scripts

```bash
npm run loadtest:reset        # 테스트 환경 초기화
npm run loadtest:good:smoke   # Good smoke 테스트
npm run loadtest:bad:smoke    # Bad smoke 테스트
npm run loadtest:good         # Good standard 프로필
npm run loadtest:bad          # Bad standard 프로필
```

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
| DB 포트 | `3307` (로컬 MySQL 3306과 충돌 방지) |
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

로컬에 이미 MySQL이 3306 포트를 쓰고 있다면, 이 프로젝트는 Docker MySQL을 **3307**로 매핑해 둡니다. `.env`의 `DB_PORT=3307`과 맞춰져 있습니다.

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
| GET | `/api/export/:jobId` | 생성 상태 조회 | Step 4 |
| GET | `/api/export/:jobId/download` | 엑셀 파일 다운로드 | Step 4 |

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
npm run loadtest:reset
npm run loadtest:good:smoke
npm run loadtest:reset
npm run loadtest:bad:smoke
```
