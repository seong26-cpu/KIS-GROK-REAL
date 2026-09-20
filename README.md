# 세력추적 스캐너

한국투자증권(KIS) 실전 Open API 시세·거래대금 순위와 공개 시황/뉴스를 쓰는 웹 스캐너입니다.

## GitHub에 올릴 때 (Yowza 오류 방지)

웹에서 폴더를 **드래그 앤 드롭하지 마세요.** 한 번에 100개 파일 제한이 있습니다.
이 압축본은 `node_modules`를 빼서 **100개 미만**입니다.

1. 이 zip을 풀어 나온 폴더만 GitHub 저장소에 올립니다.
2. `node_modules` 폴더가 있으면 절대 넣지 않습니다. 서버가 직접 설치합니다.

## Render 웹 서비스

1. [Render](https://render.com) → New → Web Service
2. 이 GitHub 저장소를 연결합니다. (파일을 직접 올리는 방식이 아닙니다)
3. 아래가 맞는지 확인합니다.
   - Runtime: Node
   - Build: `npm ci && npm run build`
   - Start: `npm run start`
4. 배포가 끝나면 Render가 준 주소로 휴대폰 브라우저에서 접속합니다.
5. 앱에서 KIS **실전** APP KEY / SECRET KEY를 입력합니다. 키는 그 휴대폰 브라우저에만 저장됩니다.

`render.yaml`이 있으면 Blueprint로도 생성할 수 있습니다.
