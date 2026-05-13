package com.mirae.academyatt.sender2

import android.content.Context
import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await

/**
 * Polls Firestore for `attendance` documents where processed==false and runs
 * each through [AttendanceDispatcher].
 *
 * Used as a foreground safety net while the admin app is open. The dispatch
 * step itself owns the dedup transaction so it is safe even if FCM arrives
 * at the same moment.
 */
object QueueSweeper {

    private const val TAG = "QueueSweeper"

    /**
     * One sweep. Returns the count of attendance documents seen as
     * processed==false at scan time (i.e. before claim/dispatch).
     */
    suspend fun runOnce(context: Context): Int {
        return try {
            val snap = FirebaseFirestore.getInstance()
                .collection("attendance")
                .whereEqualTo("processed", false)
                .limit(50)
                .get()
                .await()
            val pendingCount = snap.size()
            StatusStore.recordQueueCheck(context, pendingCount)
            Log.d(TAG, "Sweep found $pendingCount pending docs")

            for (doc in snap.documents) {
                val data = doc.data ?: continue
                val fields = AttendanceDispatcher.AttendanceFields(
                    docId = doc.id,
                    studentName = data["studentName"] as? String ?: continue,
                    attendanceType = data["type"] as? String ?: "checkin",
                    time = data["time"] as? String ?: "",
                    parentPhones = (data["parentPhones"] as? List<*>)
                        ?.mapNotNull { it as? String }
                        ?.filter { it.isNotBlank() }
                        ?: emptyList()
                )
                if (fields.parentPhones.isEmpty()) continue
                AttendanceDispatcher.dispatch(context, fields)
            }
            pendingCount
        } catch (e: Exception) {
            Log.e(TAG, "Sweep failed: ${e.message}", e)
            -1
        }
    }
}
