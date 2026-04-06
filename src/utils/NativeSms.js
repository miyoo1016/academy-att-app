import { NativeModules, Platform } from 'react-native';

const { DirectSmsModule } = NativeModules;

/**
 * 전송 버튼 클릭 없이 배경에서 즉시 문자를 발송합니다. (안드로이드 전용)
 * @param {string} phoneNumber 
 * @param {string} message 
 * @returns {Promise<boolean>}
 */
export const sendDirectSms = async (phoneNumber, message) => {
  if (Platform.OS !== 'android') {
    console.warn('NativeSms: 배경 문자 발송은 안드로이드에서만 지원됩니다.');
    return false;
  }

  if (!DirectSmsModule) {
    console.error('NativeSms: DirectSmsModule이 로드되지 않았습니다. 빌드를 확인하세요.');
    return false;
  }

  try {
    // 하이픈 제거 등 번호 정규화 (필요시)
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    return await DirectSmsModule.sendDirectSms(cleanPhone, message);
  } catch (error) {
    console.error('NativeSms 발송 실패:', error);
    return false;
  }
};

export default {
  sendDirectSms,
};
