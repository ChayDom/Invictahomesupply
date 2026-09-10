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

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Every commercial email (welcome + weekly digest) needs a real mailing
// address in its footer — required by CAN-SPAM, and explicitly required
// by this project's own spec: no welcome or digest email may send
// without one configured. Deliberately not hard-coded here or anywhere
// in source control; read at send time from BUSINESS_MAILING_ADDRESS.
// Returns null (never throws) so callers can skip sending cleanly.
export function getMailingAddress(): string | null {
  const value = Netlify.env.get("BUSINESS_MAILING_ADDRESS");
  const trimmed = (value || "").trim();
  return trimmed ? trimmed : null;
}

const EMAIL_WRAPPER_STYLE = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#eef1ea;padding:32px 16px;";
const EMAIL_CARD_STYLE = "max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;";
const EMAIL_HEADER_STYLE = "background:#24352a;color:#eef1ea;padding:24px 32px;font-size:18px;font-weight:600;";
const EMAIL_BODY_STYLE = "padding:32px;color:#24352a;font-size:15px;line-height:1.6;";
const EMAIL_BUTTON_STYLE = "display:inline-block;background:#c14a26;color:#eef1ea;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.02em;padding:14px 28px;border-radius:4px;margin:20px 0;";
const EMAIL_FOOTER_STYLE = "padding:20px 32px;color:#667061;font-size:13px;line-height:1.55;border-top:1px solid #d7ddd0;text-align:center;";
const EMAIL_FOOTER_INNER_STYLE = "max-width:340px;margin:0 auto;";

// Shared required footer — every weekly digest AND welcome email must
// carry, in order: the subscription-context line, the business name,
// the operating-entity line, the mailing address (CAN-SPAM), and a
// website/contact/unsubscribe line. Centered with a capped inner width
// so lines stay short and readable rather than stretching edge to edge
// (text-align:center, never justify — justified text at this width
// reads as ragged, uneven gaps). unsubscribeUrl/siteUrl are both built
// by the caller from data this code already trusts (a record's own
// Unsubscribe Token, and a fixed site origin) — mailingAddress is the
// one value here that's plain server config text, not path-built, so
// it's escaped like any other value that ends up in HTML. "Operated by
// Flipfusion Apps LLC" is its own line, deliberately not folded into
// mailingAddress, so the operating entity's name always renders with
// consistent spacing/capitalization instead of however it happens to
// be typed into the mailing-address config value.
// The subscription-explanation line and the business/legal identity
// block (name, operating entity, address, links) are two visually
// distinct ideas sharing one footer — split into sibling divs, the
// second offset by EMAIL_FOOTER_IDENTITY_GAP, so there's a clear
// paragraph-style gap between them. The identity block itself is
// unchanged: still one div, still joined by plain <br> at the same
// compact line-height as before.
const EMAIL_FOOTER_IDENTITY_GAP = "margin-top:14px;";

function footerHtml(unsubscribeUrl: string, siteUrl: string, mailingAddress: string): string {
  return `<div style="${EMAIL_FOOTER_STYLE}">
      <div style="${EMAIL_FOOTER_INNER_STYLE}">
        You&rsquo;re receiving this because you subscribed to weekly inventory updates from Invicta Home Supply.
      </div>
      <div style="${EMAIL_FOOTER_INNER_STYLE}${EMAIL_FOOTER_IDENTITY_GAP}">
        Invicta Home Supply<br>
        Operated by Flipfusion Apps LLC<br>
        ${escapeHtml(mailingAddress)}<br>
        <a href="${escapeHtml(siteUrl)}" style="color:#667061;">Website</a> &middot;
        <a href="mailto:hello@invictahomesupply.com" style="color:#667061;">Contact</a> &middot;
        <a href="${escapeHtml(unsubscribeUrl)}" style="color:#667061;">Unsubscribe</a>
      </div>
    </div>`;
}
function footerText(unsubscribeUrl: string, siteUrl: string, mailingAddress: string): string {
  return [
    "You're receiving this because you subscribed to weekly inventory updates from Invicta Home Supply.",
    "",
    "Invicta Home Supply",
    "Operated by Flipfusion Apps LLC",
    mailingAddress,
    `Website: ${siteUrl} | Contact: hello@invictahomesupply.com | Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");
}

// Single opt-in (Phase 1, revised): there is no confirmation step, so
// there is no confirmation email template — sending one would put a
// confirm link back in front of subscribers for a flow that no longer
// has anything for it to confirm. browseUrl/unsubscribeUrl/siteUrl are
// all fully-formed absolute URLs the caller builds (browseUrl/siteUrl
// fixed paths, unsubscribeUrl from the record's own Unsubscribe Token)
// — never anything from the request body, so no user-controlled value
// ever reaches this template; mailingAddress is plain server config
// text, escaped in the footer like any other value that reaches HTML.
// Returns {subject, html, text}; the caller adds `to`.
export function welcomeEmail(browseUrl: string, unsubscribeUrl: string, siteUrl: string, mailingAddress: string): Omit<SendEmailInput, "to"> {
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
    ${footerHtml(unsubscribeUrl, siteUrl, mailingAddress)}
  </div>
</div>`;
  const text = `You're subscribed. We'll send you one weekly email featuring newly added flooring, appliances, tools, and more.\n\nBrowse inventory: ${browseUrl}\n\nDidn't mean to subscribe, or want to stop? Unsubscribe (one click, no login needed): ${unsubscribeUrl}\n\n${footerText(unsubscribeUrl, siteUrl, mailingAddress)}`;
  return {
    subject: "You’re subscribed to Invicta inventory updates",
    html,
    text,
  };
}

export interface DigestProduct {
  name: string;
  category: string;
  priceText: string; // pre-formatted, e.g. "$1.35 / sq ft" — formatting lives in _shared/digest.mts, not here
  qtyText: string | null; // pre-formatted, e.g. "42 available" — null to omit
  imageUrl: string | null;
  detailUrl: string; // absolute URL
}

// products/browseAllUrl/unsubscribeUrl/siteUrl are all built by the
// caller (_shared/digest.mts) from Airtable data that's already been
// validated (see fetchEligibleNewProducts()) — but product Name/
// Category are free-text Airtable fields an operator could put anything
// into, so every one of those is escaped here, not assumed safe. No raw
// Product Key ever appears in visible text — detailUrl is a full URL
// used only as an href, and the key inside its query string is never
// echoed as visible text anywhere in this template.
export function digestEmail(
  products: DigestProduct[],
  opts: { browseAllUrl: string; unsubscribeUrl: string; siteUrl: string; mailingAddress: string; hasMore: boolean }
): Omit<SendEmailInput, "to"> {
  const { browseAllUrl, unsubscribeUrl, siteUrl, mailingAddress, hasMore } = opts;
  const cardStyle = "border:1px solid #d7ddd0;border-radius:6px;overflow:hidden;margin-bottom:14px;";
  const imgCellStyle = "width:96px;padding:0;";
  const imgStyle = "display:block;width:96px;height:96px;object-fit:cover;background:#eef1ea;";
  const infoCellStyle = "padding:12px 16px;vertical-align:top;";
  const catStyle = "color:#c14a26;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;";
  const nameStyle = "color:#24352a;font-size:15px;font-weight:600;margin:2px 0 4px;";
  const priceStyle = "color:#24352a;font-size:14px;font-weight:600;";
  const qtyStyle = "color:#667061;font-size:12px;margin-left:6px;";
  const viewBtnStyle = "display:inline-block;margin-top:8px;background:#24352a;color:#eef1ea;text-decoration:none;font-size:12px;font-weight:600;letter-spacing:0.02em;padding:8px 14px;border-radius:4px;";

  const rowsHtml = products
    .map((p) => {
      const safeName = escapeHtml(p.name);
      const safeCategory = escapeHtml(p.category);
      const safeUrl = escapeHtml(p.detailUrl);
      const safePrice = escapeHtml(p.priceText);
      const safeQty = p.qtyText ? escapeHtml(p.qtyText) : "";
      const imgCell = p.imageUrl
        ? `<img src="${escapeHtml(p.imageUrl)}" alt="" style="${imgStyle}">`
        : `<div style="${imgStyle}"></div>`;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${cardStyle}">
        <tr>
          <td style="${imgCellStyle}"><a href="${safeUrl}">${imgCell}</a></td>
          <td style="${infoCellStyle}">
            <div style="${catStyle}">${safeCategory}</div>
            <div style="${nameStyle}">${safeName}</div>
            <span style="${priceStyle}">${safePrice}</span>${safeQty ? `<span style="${qtyStyle}">${safeQty}</span>` : ""}
            <div><a href="${safeUrl}" style="${viewBtnStyle}">View Item</a></div>
          </td>
        </tr>
      </table>`;
    })
    .join("\n");

  const rowsText = products
    .map((p) => `- ${p.name} (${p.category}) — ${p.priceText}${p.qtyText ? `, ${p.qtyText}` : ""}\n  ${p.detailUrl}`)
    .join("\n\n");

  const moreLineHtml = hasMore
    ? `<p style="margin:16px 0 0;color:#667061;font-size:13px;">Plus more new arrivals&mdash;browse the full inventory.</p>`
    : "";
  const moreLineText = hasMore ? "\nPlus more new arrivals—browse the full inventory.\n" : "";

  // Hidden preheader: the preview snippet inbox lists (Gmail/Outlook)
  // show next to the subject, before the email is opened. Padded with
  // zero-width-joiner + nbsp repeats — the standard technique to stop
  // the inbox from falling through to real visible text (the first
  // product name) once the preheader string itself is exhausted.
  const preheaderPad = "&zwnj;&nbsp;".repeat(40);
  const html = `<div style="${EMAIL_WRAPPER_STYLE}">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">See the latest inventory available for local pickup in McKinney.${preheaderPad}</div>
  <div style="${EMAIL_CARD_STYLE}max-width:560px;">
    <div style="${EMAIL_HEADER_STYLE}text-align:center;">
      <div>New this week at Invicta Home Supply</div>
      <div style="font-size:13px;font-weight:400;margin-top:6px;">Here are the latest products added to our inventory.</div>
    </div>
    <div style="${EMAIL_BODY_STYLE}padding:24px;">
      ${rowsHtml}
      ${moreLineHtml}
      <div style="text-align:center;margin-top:20px;">
        <a href="${escapeHtml(browseAllUrl)}" style="${EMAIL_BUTTON_STYLE}">Browse All Inventory</a>
      </div>
    </div>
    ${footerHtml(unsubscribeUrl, siteUrl, mailingAddress)}
  </div>
</div>`;

  const text = `New this week at Invicta Home Supply\nHere are the latest products added to our inventory.\n\n${rowsText}\n${moreLineText}\nBrowse all inventory: ${browseAllUrl}\n\n${footerText(unsubscribeUrl, siteUrl, mailingAddress)}`;

  return {
    subject: "New this week at Invicta Home Supply",
    html,
    text,
  };
}
