import messaging from '@react-native-firebase/messaging';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { Platform, Alert } from 'react-native';

/**
 * FCM 설정 및 토큰 등록
 */
export const setupFcmToken = async () => {
    try {
        // 1. 권한 확인 (iOS 대응용이지만 안드로이드 13+에서도 필요)
        const authStatus = await messaging().requestPermission();
        const enabled =
            authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
            authStatus === messaging.AuthorizationStatus.PROVISIONAL;

        if (!enabled) {
            console.log('[FCM] 알림 권한이 거부되었습니다.');
            return null;
        }

        // 2. FCM 토큰 획득
        const token = await messaging().getToken();
        if (token) {
            console.log('[FCM] 토큰 획득 성공:', token);
            
            // 3. Firestore에 토큰 저장 (주 단말기 고정 경로)
            // Cloud Function이 이 경로를 참조하여 FCM을 보냅니다.
            const tokenRef = doc(db, 'device_tokens', 'main_phone');
            await setDoc(tokenRef, {
                token: token,
                platform: Platform.OS,
                updatedAt: serverTimestamp(),
                lastActive: serverTimestamp()
            }, { merge: true });

            console.log('[FCM] Firestore 토큰 등록 완료');
            return token;
        }
    } catch (error) {
        console.error('[FCM] 토큰 설정 오류:', error);
        return null;
    }
};

/**
 * 토큰 갱신 리스너 설정
 */
export const subscribeToTokenRefresh = () => {
    return messaging().onTokenRefresh(async (newToken) => {
        console.log('[FCM] 토큰 갱신됨:', newToken);
        const tokenRef = doc(db, 'device_tokens', 'main_phone');
        await setDoc(tokenRef, {
            token: newToken,
            updatedAt: serverTimestamp()
        }, { merge: true });
    });
};
