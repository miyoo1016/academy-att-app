# 미래학원 출결 시스템

## 앱 구조

- **태블릿 모드**: 학생이 4자리 PIN을 입력 → 등원/귀가 처리
- **관리자 모드 (폰)**: 실시간 출결 현황 확인 + 자동 문자 발송

---

## 설치 방법

### 1단계: 개발 환경 설치

```bash
# Node.js 설치 후 (https://nodejs.org)
npm install -g expo-cli

# 프로젝트 패키지 설치
cd academy_att_app
npm install
```

### 2단계: Firebase 설정 (무료)

1. [https://console.firebase.google.com](https://console.firebase.google.com) 접속
2. **프로젝트 만들기** 클릭 → 이름 입력 (예: mirae-academy)
3. **Firestore Database** 메뉴 → **데이터베이스 만들기** → **테스트 모드로 시작**
4. 프로젝트 설정(⚙) → **일반** → 아래로 스크롤 → **앱 추가** → 웹(`</>`) 선택
5. 앱 닉네임 입력 후 **앱 등록** → 아래 SDK 구성 복사

6. `src/config/firebase.js` 파일을 열어 해당 값 붙여넣기:

```javascript
const firebaseConfig = {
  apiKey: "여기에 붙여넣기",
  authDomain: "여기에 붙여넣기",
  projectId: "여기에 붙여넣기",
  storageBucket: "여기에 붙여넣기",
  messagingSenderId: "여기에 붙여넣기",
  appId: "여기에 붙여넣기"
};
```

### 3단계: Firestore 인덱스 설정

Firestore → **색인** → **단일 필드** 탭에서 아래 컬렉션 확인:
- `attendance` 컬렉션: `studentId` + `date` 쿼리가 자동으로 작동됩니다.

(앱 첫 실행 시 오류 메시지에 인덱스 생성 링크가 나타나면 클릭해서 생성)

### 4단계: 앱 실행

```bash
# 개발 서버 시작
npx expo start
```

휴대폰/태블릿에 **Expo Go** 앱 설치 후 QR 코드 스캔

---

## 앱 사용법

### 처음 실행 시
- **학생 입력 단말기** → 태블릿에서 선택
- **관리자 (선생님)** → 폰에서 선택 (비밀번호: `0000`)

> 비밀번호를 바꾸려면 `src/screens/ModeSelectScreen.js` 파일 상단의 `ADMIN_PASSWORD` 값을 수정하세요.

### 학생 등록 (관리자 폰에서)
1. 관리자 모드 → 우상단 **학생관리**
2. **+ 추가** 버튼
3. 이름, 4자리 PIN, 학부모 전화번호 입력 (최대 3명)
4. **학생 등록** 버튼

### 출결 처리 (태블릿에서)
1. 학생이 4자리 PIN 입력 후 **OK** 누름
2. 첫 번째 입력 = **등원** / 두 번째 입력 = **귀가**
3. 자동으로 Firebase에 저장됨

### 문자 발송 (관리자 폰에서 자동)
- 관리자 폰이 켜져 있으면 태블릿에서 출결 처리 즉시 자동 발송
- 발송 실패 시 목록에서 **재발송** 버튼 클릭

---

## 문자 형식

**등원**: `[미래학원] PM 04:13 홍길동 원생이 등원하였습니다. 최선을 다해 지도하겠습니다.`

**귀가**: `[미래학원] PM 05:39 홍길동 원생이 공부를 마치고 귀가할 예정입니다.`

---

## APK 빌드 (완성 후)

```bash
# EAS 빌드 설정 (최초 1회)
npm install -g eas-cli
eas login
eas build:configure

# APK 빌드
eas build -p android --profile preview
```

---

## 주의사항

- 관리자 폰과 태블릿 모두 인터넷 연결 필요 (Firebase 통신)
- 문자 발송은 **관리자 폰 앱이 실행 중**일 때만 자동으로 됩니다
- 앱 모드를 초기화하려면 설정 > 앱 > 미래학원 출결 > 저장공간 초기화
