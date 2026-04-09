// 문자 발송용 시간 포맷: PM 04:13
export const formatTimeForSMS = (date = new Date()) => {
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${period} ${displayHours.toString().padStart(2, '0')}:${minutes}`;
};

// DB 저장용 날짜: 2025-04-04 (현지 시간 기준)
export const formatDateForDB = (date = new Date()) => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// 시계 표시용: 14:30:00
export const formatClockDisplay = (date = new Date()) => {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
};

// 한국어 날짜 표시: 4월 4일(토) PM
export const formatDateKorean = (date = new Date()) => {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dayName = dayNames[date.getDay()];
  const period = date.getHours() >= 12 ? 'PM' : 'AM';
  return `${month}월 ${day}일(${dayName}) ${period}`;
};

// 출결 목록 표시용: 오후 4:13
export const formatTimeKorean = (timeStr) => {
  if (!timeStr) return '';
  return timeStr.replace('PM', '오후').replace('AM', '오전');
};
