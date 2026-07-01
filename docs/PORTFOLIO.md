# 대국민 선착순 금융 지원금 신청 및 대용량 관리자 집계 시스템

> **한 줄 소개**  
> 고트래픽 선착순 신청을 Redis·Redlock으로 처리하고, 수십만 건 엑셀을 스트리밍으로 생성하는 Node.js 백엔드 시스템

| 항목 | 내용 |
|------|------|
| **기간** | [예: 2025.03 ~ 2025.04] |
| **역할** | 백엔드 단독 설계·구현 (API, Worker, 부하 테스트, 데모 UI) |
| **GitHub** | https://github.com/junSeockYoon/subsidy-apply-system |
| **데모** | [선택: 로컬 실행 가이드 링크 또는 배포 URL] |

---

## 1. 프로젝트 배경 & 문제 정의

정부·금융권에서 흔히 발생하는 **선착순 지원금 신청** 시나리오를 가정했습니다.

- 오픈 직후 **수만~수십만 동시 요청**이 몰림
- 정원(예: 1만 명)을 넘기면 **즉시 마감**되어야 함
- 동일 사용자 **중복 신청** 방지 필요
- 관리자는 **대량 신청 내역을 엑셀**로 받아야 함

단순 CRUD가 아니라, **동시성·정합성·메모리**를 동시에 고려해야 하는 문제입니다.

---

## 2. 핵심 성과 (숫자로 말하기)

> 아래 수치는 k6 부하 테스트 / 로컬 환경 기준입니다. 실제 캡처 후 본인 결과로 교체하세요.

| 지표 | Good API (Redis) | Bad API (DB 직행) |
|------|------------------|-------------------|
| 동시 VU | [예: 10,000] | [예: 10,000] |
| 성공 처리 | [예: 10,000건 정확히 마감] | [예: 쿼터 초과·race condition] |
| p95 응답 시간 | [예: XXms] | [예: XXms] |
| 엑셀 export | [예: 10만 건 스트리밍, OOM 없음] | — |

**핵심 메시지 (면접용 한 문장)**  
> "API는 Redis에서 선차단하고, 무거운 엑셀은 Worker가 스트리밍으로 처리해 API 이벤트 루프와 메모리를 보호했습니다."

---

## 3. 시스템 아키텍처

<!-- [스크린샷 A] README 아키텍처 다이어그램 또는 직접 그린 그림 -->

```
Client → PM2 cluster (API ×4) → Redis (쿼터·중복·동시슬롯·락)
                              → MySQL (영구 저장)
API → BullMQ(Redis) → Worker → MySQL Stream → Excel 파일
```

### 역할 분리

| 컴포넌트 | 역할 |
|----------|------|
| **API (PM2 cluster)** | 짧은 요청/응답, 선착순 판단, export Job 등록 |
| **Redis** | 쿼터 DECR, 중복 SET NX, 동시 처리 슬롯(50), Redlock |
| **MySQL** | 신청 영구 저장, 관리자 통계, export 원본 데이터 |
| **Worker (PM2 fork ×1)** | BullMQ Job 소비, MySQL→Excel 스트리밍 |

---

## 4. 기술 스택 & 선정 이유

| 구분 | 기술 | 선정 이유 |
|------|------|-----------|
| Runtime | Node.js, Express | I/O 집약적 API, 빠른 프로토타이핑 |
| Process | PM2 cluster / fork | API 수평 확장 + Worker 메모리 격리 |
| Cache | Redis, Redlock | 원자적 카운터·중복 체크·분산 락 |
| Queue | BullMQ | export 비동기 처리, API 202 즉시 응답 |
| DB | MySQL 8, Sequelize | 영구 저장, `mysql2` stream 지원 |
| Excel | ExcelJS StreamWriter | 대용량 파일 OOM 방지 |
| 부하 테스트 | k6 | Good vs Bad 정량 비교 |
| Frontend | React + Vite | 이용자/관리자 데모 UI (포트폴리오 시연용) |

---

## 5. 구현 하이라이트

### 5-1. 선착순 신청 — Redis 3단 방어 + Redlock

**설계 의도**  
마감·중복 요청이 MySQL까지 가지 않도록 Redis에서 먼저 걸러내고, 통과한 요청만 DB에 기록합니다.

**처리 순서**

1. 동시 처리 슬롯 (최대 50) — DB 커넥션 풀 보호
2. Redis 쿼터 fast-fail — 0이면 DB 미접근
3. Redis 중복 체크 — DB SELECT 생략
4. Redlock 하에서 DECR → 중복 마킹 → DB INSERT

<!-- [스크린샷 1] apply.good.service.ts 전체 흐름 (28~94줄) -->
<!-- [스크린샷 2] queue.ts — tryDecrementQuota, acquireConcurrencySlot (34~44, 77~87줄) -->

**캡처 권장 코드**

| # | 파일 | 줄 | 캡처 포인트 |
|---|------|-----|-------------|
| 1 | `src/services/apply/apply.good.service.ts` | 19~27 | 주석: 처리 순서 4단계 |
| 2 | `src/services/apply/apply.good.service.ts` | 28~46 | 슬롯 → 쿼터 → 중복 (DB 전 차단) |
| 3 | `src/services/apply/apply.good.service.ts` | 50~83 | Redlock + DECR + DB INSERT |
| 4 | `src/lib/redis/queue.ts` | 3~4, 34~44 | MAX_CONCURRENT_APPLY, DECR 원자 연산 |
| 5 | `src/lib/redis/redlock.ts` | 6~12, 25~27 | 분산 락 목적 |

---

### 5-2. Bad API — 의도적 안티패턴 & 비교

**설계 의도**  
동일 요구사항을 DB만으로 처리하면 어떤 문제가 생기는지 **k6로 정량 비교**할 수 있게 했습니다.

<!-- [스크린샷 3] apply.bad.service.ts 전체 (4~13줄 주석 + 30~43줄 race condition 구간) -->

| # | 파일 | 줄 | 캡처 포인트 |
|---|------|-----|-------------|
| 6 | `src/services/apply/apply.bad.service.ts` | 4~13 | "의도적 취약 설계" 주석 |
| 7 | `src/services/apply/apply.bad.service.ts` | 30~43 | READ → INSERT → UPDATE (락 없음) |

**포트폴리오 문장 예시**  
> Bad API는 트랜잭션·행 잠금 없이 remainingQuota를 읽기 때문에, 동시 요청 시 쿼터 초과 신청이 발생합니다. k6 결과로 Good API의 Redis 선차단 효과를 수치로 입증했습니다.

---

### 5-3. PM2 멀티 프로세스

**설계 의도**  
Node.js 싱글 스레드 한계를 극복하기 위해 API만 cluster로 복제하고, Redis로 프로세스 간 상태를 공유합니다.

<!-- [스크린샷 4] ecosystem.config.js 전체 -->

| # | 파일 | 줄 | 캡처 포인트 |
|---|------|-----|-------------|
| 8 | `ecosystem.config.js` | 11~20 | API cluster 4인스턴스 |
| 9 | `ecosystem.config.js` | 21~30 | Worker fork 1인스턴스 (OOM 방지) |

---

### 5-4. 대용량 엑셀 — 비동기 + 스트리밍

**설계 의도**  
수십만 건을 API에서 한 번에 만들면 타임아웃·OOM이 발생합니다. API는 Job만 등록(202)하고, Worker가 **행 단위 스트리밍**으로 파일을 생성합니다.

<!-- [스크린샷 5] export.routes.ts — POST 202 응답 (18~27줄) -->
<!-- [스크린샷 6] export.processor.ts — stream 파이프라인 (56~63줄 주석 + 83~101줄 + 136~138줄) -->

| # | 파일 | 줄 | 캡처 포인트 |
|---|------|-----|-------------|
| 10 | `src/api/routes/export.routes.ts` | 18~27 | 202 Accepted, Job enqueue |
| 11 | `src/services/export/export.service.ts` | 32~40 | "API는 큐에 넣고 즉시 반환" 주석 |
| 12 | `src/worker/processors/export.processor.ts` | 56~63 | 스트리밍 설계 주석 |
| 13 | `src/worker/processors/export.processor.ts` | 83~101 | mysql2 stream + WorkbookWriter |
| 14 | `src/worker/processors/export.processor.ts` | 136~138 | pipeline 연결 |

**포트폴리오 문장 예시**  
> `mysql2.stream()`으로 행을 읽고 `ExcelJS.WorkbookWriter`로 디스크에 바로 쓰는 파이프라인을 구성해, 10만 건 이상도 메모리 사용량을 일정하게 유지했습니다.

---

### 5-5. 부하 테스트 (k6)

<!-- [스크린샷 7] k6 실행 결과 터미널 (good vs bad 비교) -->
<!-- [스크린샷 8] scripts/k6/apply-good.js 일부 -->

| # | 파일 | 캡처 포인트 |
|---|------|-------------|
| 15 | `scripts/k6/apply-good.js` | 시나리오·VU 설정 |
| 16 | k6 터미널 출력 | http_req_duration, 성공/실패율 |

---

## 6. 데모 UI (선택)

포트폴리오 시연용 React 페이지입니다. 백엔드 로직과 분리된 **체험·관리 도구**입니다.

<!-- [스크린샷 9] 이용자 페이지 — Good/Bad 선택, 동시 시뮬레이션 -->
<!-- [스크린샷 10] 관리자 페이지 — 통계, 신청 등록, DB 비우기, 엑셀 다운로드 -->

| # | 캡처 대상 |
|---|-----------|
| 17 | `/` 이용자 페이지 전체 |
| 18 | `/admin` 관리자 대시보드 |
| 19 | 마감 시 쿼터 배너 / 오류 메시지 (FeedbackAlert) |

---

## 7. 트레이드오프 & 한계 (면접 대비)

솔직하게 적으면 신뢰도가 올라갑니다.

| 항목 | 현재 구현 | 확장 시 |
|------|-----------|---------|
| Redis | 단일 인스턴스 | Redis Cluster / Sentinel |
| 로드밸런서 | PM2 cluster | Nginx, ALB |
| API 인스턴스 | 4 (로컬/단일 서버) | 멀티 서버 + 오토스케일 |
| Redis persistence | Docker 볼륨 기본 | RDB/AOF 명시 설정 |
| 중복 방어 | Redis + DB unique | Redis 유실 시 DB가 최종 방어 |

**한계 인정 예시**  
> 로컬·단일 서버 기준 포트폴리오 구현이며, 프로덕션 수준의 다중 AZ 배포·모니터링·장애 복구는 다음 단계로 확장 가능합니다.

---

## 8. 회고 & 배운 점

> 본인 경험으로 교체하세요. 예시:

- **동시성**은 "빠르게"만이 아니라 "맞게" 처리하는 문제라는 것을 체감했습니다.
- Redis DECR·SET NX로 DB 부하를 줄이는 **선차단 패턴**을 직접 구현해 봤습니다.
- Bad API를 의도적으로 만들고 k6로 비교해, **설계 선택의 근거**를 수치로 말할 수 있게 되었습니다.
- 대용량 export는 "한 번에 가져오기"가 아니라 **스트리밍 파이프라인**이 핵심임을 배웠습니다.

---

## 9. 실행 방법 (리뷰어용)

```bash
docker compose up -d
npm install && npm run build
npm run dev:api          # :3000
npm run dev:worker       # 엑셀 export용
npm run dev:frontend     # :5173
```

부하 테스트:

```bash
npm run loadtest:reset
npm run loadtest:good:smoke
```

---

## 부록: 스크린샷 체크리스트

캡처 시 **파일명·줄 번호가 보이게** 찍으면 리뷰어가 코드를 바로 찾을 수 있습니다.

### 필수 (코드 6장 + 결과 2장)

- [ ] **#2** `apply.good.service.ts` 28~83줄 — 선착순 핵심 로직
- [ ] **#4** `queue.ts` 34~44줄 — DECR 원자 연산
- [ ] **#6** `apply.bad.service.ts` — Good vs Bad 대비
- [ ] **#8** `ecosystem.config.js` — PM2 cluster/fork
- [ ] **#13** `export.processor.ts` 83~138줄 — 스트리밍 파이프라인
- [ ] **#10** `export.routes.ts` — 202 비동기 응답
- [ ] **#16** k6 Good API 결과
- [ ] **#16** k6 Bad API 결과 (비교용)

### 권장 (UI·아키텍처)

- [ ] **#A** 아키텍처 다이어그램
- [ ] **#17~18** 데모 UI 스크린샷
- [ ] **#3** `redlock.ts` — 락 목적 주석

### 선택 (깊이 보여주기)

- [ ] `src/api/server.ts` 24줄 — `initSubsidyRedis` (API 재시작 시 SET NX)
- [ ] `src/api/routes/apply.routes.ts` 16~35줄 — HTTP 상태코드 매핑
- [ ] Admin 페이지 엑셀 다운로드 완료 화면

---

## 포트폴리오 사이트용 짧은 버전 (복붙용)

**제목**  
대국민 선착순 금융 지원금 신청 · 대용량 엑셀 집계 시스템

**설명 (3~4문장)**  
1만 명 한정 선착순 신청에 수만 건 동시 트래픽이 몰리는 시나리오를 Node.js로 구현했습니다. Redis DECR·Redlock으로 쿼터와 중복을 선차단하고, PM2 cluster로 API를 수평 확장했습니다. Bad API와 k6 부하 테스트로 DB 직행 대비 정합성·성능 차이를 정량 비교했습니다. 관리자 엑셀은 BullMQ Worker가 MySQL Stream→ExcelJS 파이프라인으로 OOM 없이 생성합니다.

**태그**  
`Node.js` `Redis` `MySQL` `BullMQ` `PM2` `k6` `동시성` `스트리밍`
