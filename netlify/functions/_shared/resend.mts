// Minimal Resend REST client — raw fetch, same pattern as the Airtable
// calls elsewhere in this project (no SDK dependency to add/bundle).

const RESEND_FROM = "Invicta Home Supply <updates@news.invictahomesupply.com>";
const REPLY_TO = "hello@invictahomesupply.com";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Returns true/false rather than throwing — a Resend outage should never
// crash the subscribe/confirm/unsubscribe request it's part of; callers
// decide what a failed send means for their own response.
export async function sendEmail({ to, subject, html, text }: SendEmailInput): Promise<boolean> {
  const apiKey = Netlify.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("Invicta subscribe: RESEND_API_KEY is not configured — email not sent");
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        reply_to: REPLY_TO,
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      // Sanitized: status only, never the response body (which could
      // echo the recipient address back) and never the API key.
      console.warn(`Invicta subscribe: Resend request failed with status ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Invicta subscribe: Resend request threw", err instanceof Error ? err.message : String(err));
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const EMAIL_WRAPPER_STYLE = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#eef1ea;padding:32px 16px;";
const EMAIL_CARD_STYLE = "max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;";
const EMAIL_HEADER_STYLE = "background:#24352a;color:#eef1ea;padding:24px 32px;font-size:18px;font-weight:600;";
const EMAIL_BODY_STYLE = "padding:32px;color:#24352a;font-size:15px;line-height:1.6;";
const EMAIL_BUTTON_STYLE = "display:inline-block;background:#c14a26;color:#eef1ea;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.02em;padding:14px 28px;border-radius:4px;margin:20px 0;";
const EMAIL_FOOTER_STYLE = "padding:20px 32px;color:#667061;font-size:12px;border-top:1px solid #d7ddd0;";

// Single opt-in (Phase 1, revised): there is no confirmation step, so
// there is no confirmation email template — sending one would put a
// confirm link back in front of subscribers for a flow that no longer
// has anything for it to confirm. browseUrl and unsubscribeUrl are both
// fully-formed absolute URLs this function itself builds (browseUrl a
// fixed path, unsubscribeUrl from the record's own Unsubscribe Token) —
// never anything from the request body, so no user-controlled value
// ever reaches this template. Returns {subject, html, text}; the caller
// adds `to`.
export function welcomeEmail(browseUrl: string, unsubscribeUrl: string): Omit<SendEmailInput, "to"> {
  const safeBrowseUrl = escapeHtml(browseUrl);
  const safeUnsubscribeUrl = escapeHtml(unsubscribeUrl);
  const html = `<div style="${EMAIL_WRAPPER_STYLE}">
  <div style="${EMAIL_CARD_STYLE}">
    <div style="${EMAIL_HEADER_STYLE}">Invicta Home Supply</div>
    <div style="${EMAIL_BODY_STYLE}">
      <p style="margin:0 0 16px;">You&rsquo;re subscribed. We&rsquo;ll send you one weekly email featuring newly added flooring, appliances, tools, and more.</p>
      <a href="${safeBrowseUrl}" style="${EMAIL_BUTTON_STYLE}">Browse Inventory</a>
      <p style="margin:20px 0 0;color:#667061;font-size:13px;">Didn&rsquo;t mean to subscribe, or want to stop? <a href="${safeUnsubscribeUrl}" style="color:#667061;">Unsubscribe</a> — one click, no login needed.</p>
    </div>
    <div style="${EMAIL_FOOTER_STYLE}">Invicta Home Supply &middot; McKinney, TX</div>
  </div>
</div>`;
  const text = `You're subscribed. We'll send you one weekly email featuring newly added flooring, appliances, tools, and more.\n\nBrowse inventory: ${browseUrl}\n\nDidn't mean to subscribe, or want to stop? Unsubscribe (one click, no login needed): ${unsubscribeUrl}\n\nInvicta Home Supply, McKinney, TX`;
  return {
    subject: "You’re subscribed to Invicta inventory updates",
    html,
    text,
  };
}
