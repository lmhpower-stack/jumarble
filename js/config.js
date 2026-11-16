// 배포 설정 — 여기만 고치면 통신 방식이 바뀐다
//   'ws'       직접 서버 (npm start 로 띄운 server/server.js)
//   'firebase' GitHub Pages 등 정적 호스팅 + Firebase Realtime Database
//   'local'    같은 기기의 여러 탭끼리 테스트
//   'none'     진행폰 한 대로만 진행 (참가자 폰 없음)
// 주소 뒤에 ?t=local 처럼 붙이면 그 페이지에서만 임시로 바꿀 수 있다
export const TRANSPORT = 'firebase';

// 'ws' 일 때 서버 주소. 비우면 페이지를 연 주소의 /ws 를 쓴다 (서버가 페이지도 같이 띄우는 경우)
// GitHub Pages 에 화면만 올리고 서버는 따로 둔다면 예: 'wss://my-server.example.com/ws'
export const WS_URL = '';

// 'firebase' 일 때: Firebase 콘솔 > 프로젝트 설정 > 웹 앱 구성값을 붙여넣기
export const FIREBASE = {
  apiKey: 'AIzaSyDpQRQeJrynVz5tpkCv8J8Kvn1mXkKMTmE',
  authDomain: 'mable-af253.firebaseapp.com',
  databaseURL: 'https://mable-af253-default-rtdb.firebaseio.com',
  projectId: 'mable-af253',
  appId: '1:768649397179:web:bf49884fc9241d3e47ba9e'
};

export function transportKind() {
  const q = new URLSearchParams(location.search).get('t');
  return ['ws', 'firebase', 'local', 'none'].includes(q) ? q : TRANSPORT;
}
