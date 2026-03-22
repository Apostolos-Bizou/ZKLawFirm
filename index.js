const functions = require("firebase-functions");
const fetch = require("node-fetch");

exports.aiSummary = functions.https.onCall(async (data, context) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Πρέπει να είστε συνδεδεμένος.");
  }

  const { contentBlocks } = data;
  if (!contentBlocks || !Array.isArray(contentBlocks)) {
    throw new functions.https.HttpsError("invalid-argument", "Missing contentBlocks");
  }

  // Get API key from Firebase config
  const apiKey = functions.config().anthropic?.key;
  if (!apiKey) {
    throw new functions.https.HttpsError("failed-precondition", "Anthropic API key not configured. Run: firebase functions:config:set anthropic.key=YOUR_KEY");
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 3000,
        messages: [{ role: "user", content: contentBlocks }]
      })
    });

    const result = await response.json();

    if (result.error) {
      throw new functions.https.HttpsError("internal", result.error.message || "API error");
    }

    const summaryText = result.content?.map(c => c.text || "").join("") || "Δεν ήταν δυνατή η ανάλυση.";
    return { summary: summaryText };
  } catch (err) {
    console.error("AI Summary error:", err);
    throw new functions.https.HttpsError("internal", err.message || "Σφάλμα AI");
  }
});
