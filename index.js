// v5 - aiSummary + Email Notifications
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();

const ANTHROPIC_KEY = "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";

// ═══════════════════════════════════════════════════════════════
// EMAIL CONFIG - Replace with your Gmail App Password
// ═══════════════════════════════════════════════════════════════
const EMAIL_USER = "kagelaris1@gmail.com";
const EMAIL_PASS = "iyigikdmsyexjuxj";

function createTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
}

// ═══════════════════════════════════════════════════════════════
// 1. AI SUMMARY (existing)
// ═══════════════════════════════════════════════════════════════
exports.aiSummary = functions
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required");
    }
    const { contentBlocks } = data;
    if (!contentBlocks || !Array.isArray(contentBlocks)) {
      throw new functions.https.HttpsError("invalid-argument", "Missing contentBlocks");
    }
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 3000,
          messages: [{ role: "user", content: contentBlocks }],
        }),
      });
      const result = await response.json();
      if (result.error) {
        console.error("Anthropic API error:", JSON.stringify(result.error));
        throw new functions.https.HttpsError("internal", result.error.message || "API error");
      }
      const summary = result.content?.map((c) => c.text || "").join("") || "No analysis";
      return { summary };
    } catch (err) {
      console.error("AI error:", err.message || err);
      if (err instanceof functions.https.HttpsError) throw err;
      throw new functions.https.HttpsError("internal", err.message || "AI error");
    }
  });

// ═══════════════════════════════════════════════════════════════
// 2. NEW MESSAGE → EMAIL NOTIFICATION
// ═══════════════════════════════════════════════════════════════
exports.onNewMessage = functions
  .region("us-central1")
  .firestore.document("cases/{caseId}/messages/{messageId}")
  .onCreate(async (snap, context) => {
    const message = snap.data();
    const { caseId } = context.params;

    try {
      const caseDoc = await db.collection("cases").doc(caseId).get();
      if (!caseDoc.exists) return null;
      const caseData = caseDoc.data();
      const caseTitle = caseData.title || "Υπόθεση";
      const caseCode = caseData.case_code || "";

      if (message.sender_type === "client") {
        // Client → notify lawyer/admin
        let toEmail = EMAIL_USER;
        if (caseData.assigned_lawyer_id) {
          try {
            const ld = await db.collection("lawyers").doc(caseData.assigned_lawyer_id).get();
            if (ld.exists && ld.data().email) toEmail = ld.data().email;
          } catch (e) {}
        }
        const senderName = message.sender_name || "Πελάτης";
        const preview = (message.message_text || "").substring(0, 100);

        await createTransporter().sendMail({
          from: `"ZK Law Portal" <${EMAIL_USER}>`,
          to: toEmail,
          subject: `💬 Νέο μήνυμα: ${caseTitle} (${caseCode})`,
          html: `
            <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#111B2E;padding:24px 32px;text-align:center;">
                <h1 style="color:#C9A96E;font-size:24px;margin:0;letter-spacing:4px;">ZK LAW</h1>
              </div>
              <div style="padding:32px;background:#fff;">
                <h2 style="color:#111B2E;font-size:20px;margin:0 0 8px;">Νέο μήνυμα πελάτη</h2>
                <p style="color:#666;font-size:14px;margin:0 0 24px;">Υπόθεση: <strong>${caseTitle}</strong> (${caseCode})</p>
                <div style="background:#f0ede8;border-left:3px solid #C9A96E;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px;">
                  <p style="color:#333;font-size:14px;margin:0 0 8px;"><strong>${senderName}:</strong></p>
                  <p style="color:#555;font-size:14px;margin:0;line-height:1.6;">${preview}${message.message_text && message.message_text.length > 100 ? "..." : ""}</p>
                </div>
                <a href="https://zklawfirm-9bd34.web.app/admin.html" style="display:inline-block;padding:14px 32px;background:#C9A96E;color:#111B2E;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Δείτε το μήνυμα</a>
              </div>
              <div style="padding:16px 32px;text-align:center;color:#999;font-size:12px;">ZK Law Firm — Notification</div>
            </div>`,
        });
        console.log(`Email to lawyer: ${toEmail} for case ${caseCode}`);
      } else {
        // Office → notify client
        if (!caseData.client_id) return null;
        const clientDoc = await db.collection("clients").doc(caseData.client_id).get();
        if (!clientDoc.exists || !clientDoc.data().email) return null;
        const client = clientDoc.data();
        const clientName = client.full_name || client.company_name || "Πελάτη";

        await createTransporter().sendMail({
          from: `"ZK Law Firm" <${EMAIL_USER}>`,
          to: client.email,
          subject: `Νέο μήνυμα — ${caseTitle}`,
          html: `
            <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#111B2E;padding:24px 32px;text-align:center;">
                <h1 style="color:#C9A96E;font-size:24px;margin:0;letter-spacing:4px;">ZK LAW</h1>
              </div>
              <div style="padding:32px;background:#fff;">
                <h2 style="color:#111B2E;font-size:20px;margin:0 0 8px;">Αγαπητέ/ή ${clientName},</h2>
                <p style="color:#666;font-size:14px;margin:0 0 24px;">Έχετε νέο μήνυμα στην υπόθεση <strong>${caseTitle}</strong>.</p>
                <div style="background:#f0ede8;border-left:3px solid #C9A96E;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px;">
                  <p style="color:#555;font-size:14px;margin:0;">Το γραφείο σας έστειλε μήνυμα. Συνδεθείτε στο portal για να το δείτε.</p>
                </div>
                <a href="https://zklawfirm-9bd34.web.app" style="display:inline-block;padding:14px 32px;background:#C9A96E;color:#111B2E;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Σύνδεση στο Portal</a>
                <p style="color:#999;font-size:12px;margin:24px 0 0;">Για ασφάλεια, το περιεχόμενο δεν εμφανίζεται στο email.</p>
              </div>
              <div style="padding:16px 32px;text-align:center;color:#999;font-size:12px;">ZK Law Firm — Notification</div>
            </div>`,
        });
        console.log(`Email to client: ${client.email} for case ${caseCode}`);
      }
    } catch (error) {
      console.error("onNewMessage error:", error);
    }
    return null;
  });

// ═══════════════════════════════════════════════════════════════
// 3. CASE STAGE CHANGED → EMAIL CLIENT
// ═══════════════════════════════════════════════════════════════
exports.onCaseUpdate = functions
  .region("us-central1")
  .firestore.document("cases/{caseId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    if (before.current_stage === after.current_stage) return null;

    try {
      if (!after.client_id) return null;
      const clientDoc = await db.collection("clients").doc(after.client_id).get();
      if (!clientDoc.exists || !clientDoc.data().email) return null;
      const client = clientDoc.data();
      const clientName = client.full_name || client.company_name || "Πελάτη";
      const caseTitle = after.title || "Υπόθεση";
      const caseCode = after.case_code || "";

      const stages = {
        1: "Η υπόθεση καταγράφηκε",
        2: "Αρχικός νομικός έλεγχος",
        3: "Συγκέντρωση εγγράφων",
        4: "Νομική επεξεργασία",
        5: "Νομική ενέργεια",
        6: "Αναμονή εξέλιξης",
        7: "Απαιτείται νέα ενέργεια",
        8: "Ολοκλήρωση",
      };
      const newStage = stages[after.current_stage] || `Στάδιο ${after.current_stage}`;

      await createTransporter().sendMail({
        from: `"ZK Law Firm" <${EMAIL_USER}>`,
        to: client.email,
        subject: `Ενημέρωση: ${caseTitle} — ${newStage}`,
        html: `
          <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:#111B2E;padding:24px 32px;text-align:center;">
              <h1 style="color:#C9A96E;font-size:24px;margin:0;letter-spacing:4px;">ZK LAW</h1>
            </div>
            <div style="padding:32px;background:#fff;">
              <h2 style="color:#111B2E;font-size:20px;margin:0 0 8px;">Ενημέρωση υπόθεσης</h2>
              <p style="color:#666;font-size:14px;margin:0 0 24px;">Αγαπητέ/ή ${clientName},</p>
              <div style="background:#f0ede8;border-left:3px solid #4CAF82;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px;">
                <p style="color:#333;font-size:14px;margin:0 0 4px;"><strong>${caseTitle}</strong> (${caseCode})</p>
                <p style="color:#4CAF82;font-size:16px;margin:0;font-weight:600;">→ ${newStage}</p>
              </div>
              ${after.next_step ? `<p style="color:#555;font-size:14px;margin:0 0 24px;">Επόμενο βήμα: <strong>${after.next_step}</strong></p>` : ""}
              ${after.action_required ? `<p style="color:#E8A848;font-size:14px;margin:0 0 24px;font-weight:600;">⚡ Απαιτείται ενέργεια από εσάς</p>` : ""}
              <a href="https://zklawfirm-9bd34.web.app" style="display:inline-block;padding:14px 32px;background:#C9A96E;color:#111B2E;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Δείτε τις λεπτομέρειες</a>
            </div>
            <div style="padding:16px 32px;text-align:center;color:#999;font-size:12px;">ZK Law Firm — Notification</div>
          </div>`,
      });
      console.log(`Stage email to ${client.email} for ${caseCode}`);
    } catch (error) {
      console.error("onCaseUpdate error:", error);
    }
    return null;
  });
