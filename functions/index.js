const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * attendance 컬렉션에 새 문서가 생기면 실행됨 (FCM 알림 전송)
 */
exports.sendAttendanceFcm = onDocumentCreated("attendance/{docId}", async (event) => {
    const snapshot = event.data;
    if (!snapshot) return null;

    const data = snapshot.data();
    if (data.processed || !data.studentName) return null;

    try {
        const tokenDoc = await admin.firestore().doc("device_tokens/main_phone").get();
        if (!tokenDoc.exists) {
            console.error("Main phone token not found");
            return null;
        }

        const fcmToken = tokenDoc.data().token;
        console.log(`Sending FCM to token: ${fcmToken ? fcmToken.substring(0, 10) + '...' : 'NULL'}`);
        const message = {
            data: {
                type: "ATTENDANCE_SMS",
                id: event.params.docId,
                studentName: data.studentName,
                attendanceType: data.type || "checkin",
                time: data.time || "",
                parentPhones: JSON.stringify(data.parentPhones || [])
            },
            android: {
                priority: "high",
                ttl: 0
            },
            token: fcmToken
        };

        const response = await admin.messaging().send(message);
        console.log(`Successfully sent FCM for ${data.studentName}`);
        return response;

    } catch (error) {
        console.error("Error sending FCM:", error);
        return null;
    }
});
