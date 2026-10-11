# Global Trip & Expense Manager

출장 영수증을 찍으면 AI가 읽어 정리하고, 규정을 검사해 PDF·Excel 리포트로 만들어 주는 앱입니다 (iOS · Android · Web).

설계 문서: [글로벌 출장 경비 관리 앱 설계 문서 v1](https://claude.ai/code/artifact/51d03478-bcd1-462d-80c8-6078d3ca7c65)

## 구조

| 경로 | 내용 |
| --- | --- |
| `apps/mobile` | Expo(SDK 57) + Expo Router 앱, TypeScript strict |
| `apps/mobile/src/domain` | 플랫폼과 무관한 핵심 로직: 금액·환율 계산, 규정 판정, AI 응답 스키마 |
| `supabase/migrations` | Postgres 스키마, RLS, 스토리지 버킷 |
| `supabase/seed.sql` | 기본 제공 리포트 서식 (Executive PDF, Modern Excel) |
| `supabase/tests` | CI에서 마이그레이션을 검증하는 스모크 테스트 |

## 로컬 실행

```bash
cd apps/mobile
npm install
npm run web        # 브라우저에서 실행
npm start          # Expo Go 앱으로 폰에서 실행 (QR 코드)
npm run typecheck
npm test
```

Supabase 스키마는 [Supabase CLI](https://supabase.com/docs/guides/cli)로 `supabase start` 후 `supabase db reset`을 실행하면 마이그레이션과 시드가 적용됩니다.
