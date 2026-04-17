const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * attendance 컬렉션에 새 문서가 생기면 실행됨
 */
exports.sendAttendanceFcm = onDocumentCreated("attendance/{docId}", async (event) => {
    const snapshot = event.data;
    if (!snapshot) return null;

    const data = snapshot.data();
    // 이미 처리되었거나 데이터가 부실하면 종료
    if (data.processed || !data.studentName) return null;

    try {
        // 1. 주 단말기의 토큰 가져오기 (device_tokens/main_phone 에 저장된 것으로 가정)
        // 이 경로는 나중에 앱에서 토큰을 저장할 경로와 일치시켜야 함
        const tokenDoc = await admin.firestore().doc("device_tokens/main_phone").get();
        if (!tokenDoc.exists) {
            console.error("Main phone token not found in device_tokens/main_phone");
            return null;
        }

        const fcmToken = tokenDoc.data().token;
        if (!fcmToken) {
            console.error("FCM Token is empty");
            return null;
        }

        // 2. FCM 데이터 메시지 구성 (공식 경로)
        // 알림(Notification)이 아닌 데이터(Data) 메시지로 보내야 백그라운드에서 직접 처리가 용이함
        const message = {
            data: {
                type: "ATTENDANCE_SMS", // 직접 처리할 타입
                id: event.params.docId,
                studentName: data.studentName,
                attendanceType: data.type || "checkin",
                time: data.time || "",
                parentPhones: JSON.stringify(data.parentPhones || [])
            },
            android: {
                priority: "high", // 중요: OS가 깨우도록 강제
                ttl: 0 // 즉시 발송
            },
            token: fcmToken
        };

        // 3. 메시지 발송
        const response = await admin.messaging().send(message);
        console.log(`Successfully sent FCM to ${data.studentName}:`, response);
        return response;

    } catch (error) {
        console.error("Error sending FCM:", error);
        return null;
    }
});
