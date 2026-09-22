# 세력추적 스캐너

한국투자증권(KIS) 실전 Open API 시세·거래대금 순위와 공개 시황/뉴스를 쓰는 웹 스캐너입니다.

## Render 배포 (KIS-GROK-REAL)

이 저장소는 Render 웹 서비스용입니다. **Vercel 프리셋으로 빌드하면 실패합니다.**

Render Settings가 아래와 같아야 합니다.

- Runtime: Node 22
- Build Command: `npm ci && npm run build`
- Start Command: `npm run start`
- Environment:
  - `NODE_VERSION` = `22`
  - `NITRO_PRESET` = `render-com`

배포가 끝나면 Render URL로 휴대폰에서 열고, 앱에서 KIS **실전** APP KEY / SECRET KEY를 입력하세요.
