/**
 * Invicta Home Supply — Social Queue + Gemini + Buffer automation
 *
 * Flow:
 * Website Export
 *   -> Social Queue
 *   -> Gemini social copy
 *   -> Manual Ready approval
 *   -> Photos-only immutable Cloudinary media
 *   -> Buffer shareNow after final stock validation
 *
 * Existing Script Property reused:
 *   GEMINI_API_KEY
 *
 * New Script Property required later:
 *   BUFFER_API_KEY
 *
 * setupBufferChannels() discovers and stores:
 *   BUFFER_ORGANIZATION_ID
 *   BUFFER_FACEBOOK_CHANNEL_ID
 *   BUFFER_INSTAGRAM_CHANNEL_ID
 *
 * One existing queue, rolling 48-hour cadence, receipt-before-value journals.
 * Optional FFmpeg Reels are prepared separately; publishing is OFF by default.
 */

const SOCIAL_CONFIG_ = Object.freeze({
  QUEUE_SHEET: 'Social Queue',
  EXPORT_SHEET: 'Website Export',

  GEMINI_BATCH_SIZE: 5,
  

  BUFFER_ENDPOINT: 'https://api.buffer.com',

  BUFFER_API_KEY_PROPERTY:
    'BUFFER_API_KEY',

  BUFFER_ORG_PROPERTY:
    'BUFFER_ORGANIZATION_ID',

  BUFFER_FB_CHANNEL_PROPERTY:
    'BUFFER_FACEBOOK_CHANNEL_ID',

  BUFFER_IG_CHANNEL_PROPERTY:
    'BUFFER_INSTAGRAM_CHANNEL_ID',

  WEBSITE_BASE_URL:
    'https://invictahomesupply.com/product.html?id='
});


const SOCIAL_COLUMNS_ = Object.freeze({
  PRODUCT_KEY: 1,
  PRODUCT_NAME: 2,
  CATEGORY: 3,
  PRICE: 4,
  MEDIA_URL: 5,
  MEDIA_TYPE: 6,
  PRODUCT_URL: 7,
  CONTENT_TYPE: 8,
  HOOK: 9,
  FACEBOOK_CAPTION: 10,
  INSTAGRAM_CAPTION: 11,
  HASHTAGS: 12,
  SOCIAL_STATUS: 13,
  FB_BUFFER_POST_ID: 14,
  IG_BUFFER_POST_ID: 15,
  LAST_POSTED_AT: 16,
  GENERATED_AT: 17,
  SOURCE_HASH: 18,
  ERROR: 19
});


const SOCIAL_REQUIRED_HEADERS_ =
  Object.freeze([
    'PRODUCT KEY',
    'PRODUCT NAME',
    'CATEGORY',
    'PRICE',
    'MEDIA URL',
    'MEDIA TYPE',
    'PRODUCT URL',
    'CONTENT TYPE',
    'HOOK',
    'FACEBOOK CAPTION',
    'INSTAGRAM CAPTION',
    'HASHTAGS',
    'SOCIAL STATUS',
    'FB BUFFER POST ID',
    'IG BUFFER POST ID',
    'LAST POSTED AT',
    'GENERATED AT',
    'SOURCE HASH',
    'ERROR'
  ]);


/**
 * Pull currently published/in-stock products
 * from Website Export into Social Queue.
 *
 * Every existing row is reconciled; stale legacy Ready approvals are invalidated.
 * Historical receipts/journals and captions are preserved.
 *
 * Rows are never automatically deleted.
 */
function syncSocialQueueFromCatalog(productKeys) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another Apps Script maintenance/social run is active.');
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet(), queue = getSocialQueueSheetOrThrow_(ss);
    assertSocialQueueHeaders_(queue);
    return reconcileSocialQueue_(queue,readSocialSourceMap_(getInventorySheetOrThrow_(ss,SOCIAL_CONFIG_.EXPORT_SHEET)),productKeys);
  } finally { lock.releaseLock(); }
}


/**
 * Normal production caption generator.
 */
function generateSocialCaptions() {

  return generateSocialCaptions_(
    SOCIAL_CONFIG_
      .GEMINI_BATCH_SIZE
  );
}


/**
 * SAFE TEST:
 * Generates ONE social caption only.
 */
function generateOneSocialCaptionTest() {

  return generateSocialCaptions_(1);
}


/**
 * Generates social copy for
 * Draft / Needs Copy rows.
 *
 * Generated copy stays Draft.
 * Nothing is automatically approved.
 */
function generateSocialCaptions_(
  limit
) {

  const apiKey =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        ENRICHMENT_CONFIG
          .API_KEY_PROPERTY
      );


  if (!apiKey) {

    throw new Error(
      'Missing Script Property ' +
      ENRICHMENT_CONFIG
        .API_KEY_PROPERTY +
      '.'
    );
  }


  const lock =
    LockService.getScriptLock();


  if (!lock.tryLock(30000)) {

    throw new Error(
      'Another Apps Script maintenance/social run is active.'
    );
  }


  const summary = {
    processed: 0,
    generated: 0,
    failed: 0
  };


  try {

    const ss =
      SpreadsheetApp
        .getActiveSpreadsheet();


    const queue =
      getSocialQueueSheetOrThrow_(
        ss
      );


    const exportSheet =
      getInventorySheetOrThrow_(
        ss,
        SOCIAL_CONFIG_
          .EXPORT_SHEET
      );


    assertSocialQueueHeaders_(
      queue
    );


    const sourceMap =
      readSocialSourceMap_(
        exportSheet
      );


    const lastRow =
      getLastDataRowInColumn_(
        queue,
        SOCIAL_COLUMNS_
          .PRODUCT_KEY
      );


    if (lastRow < 2) {
      return summary;
    }


    const rows =
      queue
        .getRange(
          2,
          1,
          lastRow - 1,
          SOCIAL_COLUMNS_.ERROR
        )
        .getValues();


    for (
      let i = 0;
      i < rows.length &&
      summary.processed < limit;
      i++
    ) {

      const row =
        rows[i];

      if (evergreenIdentity_(row[0])) continue; // Editorial source owns copy; no Gemini/inventory fallback.


      const status =
        String(
          row[
            SOCIAL_COLUMNS_
              .SOCIAL_STATUS - 1
          ] || ''
        ).trim();


      const existingFacebookCaption =
  String(
    row[
      SOCIAL_COLUMNS_
        .FACEBOOK_CAPTION - 1
    ] || ''
  ).trim();

const existingInstagramCaption =
  String(
    row[
      SOCIAL_COLUMNS_
        .INSTAGRAM_CAPTION - 1
    ] || ''
  ).trim();

if (
  status !== 'Needs Copy' &&
  !(
    status === 'Draft' &&
    !existingFacebookCaption &&
    !existingInstagramCaption
  )
) {
  continue;
}


      const productKey =
        String(
          row[
            SOCIAL_COLUMNS_
              .PRODUCT_KEY - 1
          ] || ''
        ).trim();


      const source =
        sourceMap.get(
          productKey
        );


      const rowNumber =
        i + 2;


      summary.processed++;


      if (
        !source ||
        !source.eligible
      ) {

        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .SOCIAL_STATUS
          )
          .setValue(
            'Error'
          );


        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_.ERROR
          )
          .setValue(
            'Product is no longer eligible in Website Export ' +
            '(must be Post to Website + In Stock).'
          );


        summary.failed++;

        continue;
      }


      try {

        const result =
          callGeminiSocialWriter_(
            source,
            apiKey,
            row
          );


        validateSocialWriterResult_(
          result
        );


        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_.HOOK
          )
          .setValue(
            result.hook
          );


        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .FACEBOOK_CAPTION
          )
          .setValue(
            result.facebook_caption
          );


        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .INSTAGRAM_CAPTION
          )
          .setValue(
            result.instagram_caption
          );


        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .HASHTAGS
          )
          .setValue(
            result.hashtags.join(' ')
          );


        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .GENERATED_AT
          )
          .setValue(
            new Date()
          );


        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .SOURCE_HASH
          )
          .setValue(
            buildSocialSourceHash_(
              source
            )
          );


        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_.ERROR
          )
          .clearContent();


        const hasPhotos = source.photos && source.photos.length > 0 && !source.mediaError;


        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .SOCIAL_STATUS
          )
          .setValue(
            hasPhotos
              ? 'Draft'
              : 'Needs Image'
          );


        summary.generated++;

      } catch (error) {

        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .SOCIAL_STATUS
          )
          .setValue(
            'Error'
          );


        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_.ERROR
          )
          .setValue(
            'Social copy generation failed: ' +
            String(
              error.message ||
              error
            ).slice(
              0,
              500
            )
          );


        summary.failed++;
      }
    }


    console.log(
      JSON.stringify(
        summary
      )
    );


    return summary;

  } finally {

    lock.releaseLock();
  }
}


/**
 * Run once AFTER adding
 * BUFFER_API_KEY to Script Properties.
 *
 * Automatically discovers one Facebook
 * and one Instagram Buffer channel.
 */
function setupBufferChannels() {

  const props =
    PropertiesService
      .getScriptProperties();


  const apiKey =
    props.getProperty(
      SOCIAL_CONFIG_
        .BUFFER_API_KEY_PROPERTY
    );


  if (!apiKey) {

    throw new Error(
      'Missing Script Property BUFFER_API_KEY. ' +
      'Add your Buffer personal API key in ' +
      'Project Settings > Script Properties.'
    );
  }


  const accountResult =
    bufferGraphql_(
      apiKey,

      'query GetOrganizations { ' +
      'account { organizations { id name } } ' +
      '}',

      {}
    );


  const organizations =
    (
      (
        accountResult || {}
      ).account || {}
    ).organizations || [];


  let organizationId =
    props.getProperty(
      SOCIAL_CONFIG_
        .BUFFER_ORG_PROPERTY
    );


  if (!organizationId) {

    if (
      organizations.length !== 1
    ) {

      throw new Error(
        'Expected exactly one Buffer organization but found ' +
        organizations.length +
        '. Set BUFFER_ORGANIZATION_ID manually if you intentionally use more than one.'
      );
    }


    organizationId =
      organizations[0].id;
  }


  const channelQuery =
    'query GetChannels { ' +
    'channels(input: { organizationId: "' +
    escapeGraphqlString_(
      organizationId
    ) +
    '" }) { ' +
    'id name displayName service isQueuePaused ' +
    '} }';


  const channelResult =
    bufferGraphql_(
      apiKey,
      channelQuery,
      {}
    );


  const channels =
    (
      channelResult || {}
    ).channels || [];


  const fb =
    channels.filter(
      function(channel) {

        return String(
          channel.service || ''
        )
          .toLowerCase()
          .indexOf(
            'facebook'
          ) >= 0;
      }
    );


  const ig =
    channels.filter(
      function(channel) {

        return String(
          channel.service || ''
        )
          .toLowerCase()
          .indexOf(
            'instagram'
          ) >= 0;
      }
    );


  if (
    fb.length !== 1 ||
    ig.length !== 1
  ) {

    const safeList =
      channels
        .map(
          function(channel) {

            return (
              String(
                channel.service || ''
              ) +
              ': ' +
              String(
                channel.displayName ||
                channel.name ||
                ''
              ) +
              ' [' +
              channel.id +
              ']'
            );
          }
        )
        .join('\n');


    throw new Error(
      'Could not uniquely choose one Facebook and one Instagram channel.\n' +
      safeList +
      '\nSet BUFFER_FACEBOOK_CHANNEL_ID and ' +
      'BUFFER_INSTAGRAM_CHANNEL_ID manually in Script Properties.'
    );
  }


  props.setProperties(
    {
      BUFFER_ORGANIZATION_ID:
        organizationId,

      BUFFER_FACEBOOK_CHANNEL_ID:
        fb[0].id,

      BUFFER_INSTAGRAM_CHANNEL_ID:
        ig[0].id
    },
    false
  );


  const result = {

    organization:
      organizations.length === 1
        ? (
            organizations[0].name ||
            organizationId
          )
        : organizationId,

    facebook:
      fb[0].displayName ||
      fb[0].name ||
      fb[0].id,

    instagram:
      ig[0].displayName ||
      ig[0].name ||
      ig[0].id,

    facebookQueuePaused:
      fb[0].isQueuePaused === true,

    instagramQueuePaused:
      ig[0].isQueuePaused === true
  };


  console.log(
    JSON.stringify(
      result
    )
  );


  return result;
}


/**
 * Harmless Buffer authentication test.
 * Does not create a post.
 */
function testBufferConnection() {

  const props =
    PropertiesService
      .getScriptProperties();


  const apiKey =
    props.getProperty(
      SOCIAL_CONFIG_
        .BUFFER_API_KEY_PROPERTY
    );


  if (!apiKey) {

    throw new Error(
      'Missing BUFFER_API_KEY Script Property.'
    );
  }


  const result =
    bufferGraphql_(
      apiKey,

      'query BufferConnectionTest { ' +
      'account { id name organizations { id name } } ' +
      '}',

      {}
    );


  console.log(
    JSON.stringify(
      result
    )
  );


  return result;
}


/**
 * Sends Ready rows to Buffer.
 *
 * Our automation owns cadence. Buffer shareNow is only called after validation.
 */
function sendReadySocialPostsToBuffer() {
  return sendReadySocialMedia_();
}



/*
 * First accepted channel/journal counts toward cadence, including partial sends.
 */


/**
 * Gemini social-copy request.
 *
 * No Google Search is used here.
 * Facts are already verified upstream.
 */
function callGeminiSocialWriter_(
  source,
  apiKey,
  queueRow
) {

  const endpoint =
    'https://generativelanguage.googleapis.com/' +
    'v1beta/interactions';


  const payload = {

    model:
      ENRICHMENT_CONFIG.MODEL,

    input:
      buildGeminiSocialPrompt_(
        source,
        queueRow
      )
  };


  const response =
    UrlFetchApp.fetch(
      endpoint,
      {
        method: 'post',

        contentType:
          'application/json',

        headers: {
          'x-goog-api-key':
            apiKey
        },

        payload:
          JSON.stringify(
            payload
          ),

        muteHttpExceptions:
          true
      }
    );


  const statusCode =
    response.getResponseCode();


  const body =
    response.getContentText();


  if (
    statusCode < 200 ||
    statusCode >= 300
  ) {

    throw new Error(
      'Gemini API HTTP ' +
      statusCode +
      ': ' +
      body.slice(
        0,
        500
      )
    );
  }


  const responseJson =
    JSON.parse(
      body
    );


  const responseText =
    extractSocialGeminiText_(
      responseJson
    );


  if (!responseText) {

    throw new Error(
      'Gemini returned no social-copy text.'
    );
  }


  return parseSocialGeminiJson_(
    responseText
  );
}


/**
 * Social-writing instructions.
 */
function buildGeminiSocialPrompt_(
  source,
  queueRow
) {

  const ownUrl =
    SOCIAL_CONFIG_
      .WEBSITE_BASE_URL +
    encodeURIComponent(
      source.productKey
    );


  const contentType =
    String(
      queueRow[
        SOCIAL_COLUMNS_
          .CONTENT_TYPE - 1
      ] || 'Post'
    ).trim();


  return [

'You are the social copywriter for Invicta Home Supply, a local home-improvement and value retail business serving McKinney and the DFW area.',

'Write polished, natural social copy from VERIFIED PRODUCT FACTS ONLY.',

'Never invent a specification, discount, retail comparison, stock quantity, scarcity claim, shipping claim, installation claim, or performance claim.',

'Invicta Home Supply does NOT provide or imply its own product warranty.',

'Only mention a warranty when a manufacturer warranty is explicitly present in the VERIFIED PRODUCT FACTS.',

'When mentioning a verified warranty, clearly attribute it to the manufacturer. For example: "Manufacturer 12-month warranty" or "Covered by the manufacturer warranty." Never write wording such as "backed by us", "our warranty", or anything that could imply Invicta Home Supply provides the warranty.',

'If the verified facts do not explicitly identify a manufacturer warranty, omit warranty information completely.',

'Warranty information is optional marketing content. When in doubt, leave it out.',

'Do not mention the source retailer or retailer SKU.',

'Tone: friendly, confident, local, professional, straightforward, not corporate and not hype-heavy.',

'Keep the copy SHORT and visually easy to scan. Do not write long introductory paragraphs.',

'For BOTH Facebook and Instagram, product feature lines MUST begin with relevant emojis/icons. Do NOT use plain bullet characters such as •, -, or * for product features.',

'Choose emojis that match the verified fact. Examples: 💧 water/waterproof, ⚡ electrical/power, 📏 dimensions, 🛡️ durability/protection, 🏠 home products, 🔥 heating, 🧰 tools, 🌿 lawn/outdoor, 📍 location, 💬 message/DM. Do not force an irrelevant emoji.',

'Use a short opening hook, normally one sentence or less.',

'Facebook format: short hook, then 3-5 emoji-led product facts, then a short price/location/CTA. It may include the clickable Invicta product URL for details.',

'Instagram format: short hook, then 3-5 emoji-led product facts, then a short McKinney/DM/link-in-bio CTA.',

'The CTA may say the item is available in McKinney, invite the customer to DM us, and direct them to the Invicta product page to view details.',

'If a price is supplied, include that exact price wording once. Do not change its unit.',

'Never say or imply that customers can purchase, buy, order, check out, pay, or complete a transaction on the website unless that capability is explicitly supplied in the verified facts.',

'Do not repeat the full product name unnecessarily after introducing it.',

'Use exactly 5 highly relevant hashtags. Include #InvictaHomeSupply, one McKinney or DFW local hashtag, and three product/category-specific hashtags. Do not use unrelated audience hashtags such as Realtors, Investors, Designers, Contractors, or Homeowners unless the post specifically targets that audience.',

'Do not use fake urgency such as "today only", "selling fast", or "last chance".',

    '',

    'Content type: ' +
      contentType,

    'Product key: ' +
      source.productKey,

    'Product name: ' +
      source.displayName,

    'Category: ' +
      source.category,

    'Price: ' +
      (
        source.priceLabel ||
        'not provided'
      ),

    'Description: ' +
      (
        source.description ||
        ''
      ),

    'Verified highlights: ' +
      (
        source.highlights ||
        ''
      ),

    'Invicta product URL: ' +
      ownUrl,

    '',

    'Return ONLY valid JSON with exactly these keys:',

    '{',

    '  "hook": "short attention-grabbing hook",',

    '  "facebook_caption": "complete Facebook caption",',

    '  "instagram_caption": "complete Instagram caption without the hashtag block",',

    '  "hashtags": ["#Tag1", "#Tag2"]',

    '}',

    '',

    'Formatting guidance:',

'- Hook: one short line, normally 3-10 words.',

'- Facebook: normally 150-400 characters before the product URL. Keep it short and scan-friendly.',

'- Instagram: normally 150-350 characters before hashtags. Keep it short and visual.',

'- BOTH Facebook and Instagram MUST use emoji-led product feature lines.',

'- Each important product fact/spec should be on its own short line beginning with a relevant emoji.',

'- Do NOT use plain bullets such as •, -, or * for product feature lines.',

'- Prefer 3-5 useful product facts rather than trying to include every available specification.',

'- Keep introductory text to one short sentence. Do not write paragraph-style product descriptions.',

'- Avoid repeating the same fact multiple times.',

'- Hashtags must be separate in the hashtags array, not repeated inside facebook_caption or instagram_caption.'

  ].join('\n');
}


/**
 * Validate Gemini result before
 * writing it to Social Queue.
 */
function validateSocialWriterResult_(
  result
) {

  if (
    !result ||
    typeof result !== 'object'
  ) {

    throw new Error(
      'Gemini social output was not an object.'
    );
  }


  result.hook =
    String(
      result.hook || ''
    ).trim();


  result.facebook_caption =
    String(
      result.facebook_caption ||
      ''
    ).trim();


  result.instagram_caption =
    String(
      result.instagram_caption ||
      ''
    ).trim();


  result.hashtags =
    Array.isArray(
      result.hashtags
    )
      ? result.hashtags
          .map(
            function(tag) {

              return String(
                tag || ''
              ).trim();
            }
          )
          .filter(Boolean)
      : [];


  if (
    !result.hook ||
    !result.facebook_caption ||
    !result.instagram_caption
  ) {

    throw new Error(
      'Gemini social output is missing hook/Facebook/Instagram copy.'
    );
  }


  if (
    result.facebook_caption.length >
      1500 ||

    result.instagram_caption.length >
      1500
  ) {

    throw new Error(
      'Gemini social caption exceeded the safety length limit.'
    );
  }


  result.hashtags =
    Array.from(
      new Set(
        result.hashtags
      )
    )
      .slice(
        0,
        5
      )
      .map(
        function(tag) {

          return tag.charAt(0) === '#'
            ? tag
            : '#' +
                tag.replace(
                  /^#+/,
                  ''
                );
        }
      );


  if (
    result.hashtags.length < 3
  ) {

    throw new Error(
      'Gemini returned too few hashtags.'
    );
  }
}


/*
 * Buffer's documented CreatePostInput has no native idempotency key. The
 * existing FB/IG ID cells own both receipt (value) and durable intent (note).
 * Never remove these notes to retry. Unknown outcomes require reconciliation,
 * and absence from a remote listing is NOT proof a timed-out create failed.
 * Existing Error/Queued states preserve the strict workbook dropdown/schema.
 */
function socialOperationKey_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, JSON.stringify(payload), Utilities.Charset.UTF_8
  )).replace(/=+$/g, '');
}

function socialRowFingerprint_(row) {
  // Include all approved input, not mutable operational receipt/status cells.
  return socialOperationKey_(row.slice(0, 12).concat([row[17]]).map(function(v) {
    return String(v == null ? '' : v);
  }));
}

function assertSocialSendRowUnchanged_(queue, rowNumber, expected) {
  const current = queue.getRange(rowNumber, 1, 1, 19).getValues()[0];
  if (socialRowFingerprint_(current) !== socialRowFingerprint_(expected)) {
    throw new Error('Queue row was edited/moved; review approval before retry.');
  }
  const key = String(expected[0] || '').trim();
  const keys = queue.getRange(2, 1, queue.getLastRow() - 1, 1).getValues();
  if (!key || keys.filter(function(r) { return String(r[0] || '').trim() === key; }).length !== 1) {
    throw new Error('Missing or duplicate Social Queue Product Key.');
  }
  [14, 15].forEach(function(column) {
    const intent = readSocialBufferIntent_(queue.getRange(rowNumber, column));
    if (intent && intent.rowFingerprint !== socialRowFingerprint_(expected)) {
      throw new Error('Approved row differs from durable Buffer intent; reconcile manually.');
    }
  });
  if (String(current[12] || '').trim() !== 'Ready' &&
      !(String(current[12] || '').trim() === 'Error' &&
        [14,15].some(function(column) { return !!queue.getRange(rowNumber,column).getNote(); }))) {
    throw new Error('Queue approval/status changed; remote create blocked.');
  }
  return current;
}

function readSocialBufferIntent_(cell) {
  const note = cell.getNote();
  if (!note) return null;
  let intent;
  try { intent = JSON.parse(note); } catch (_) { throw new Error('Unrecognized Buffer ID-cell note; review required.'); }
  if (!['INVICTA_BUFFER_INTENT_V1','INVICTA_BUFFER_INTENT_V2'].includes(intent.kind) || !intent.payload ||
      intent.operationKey !== socialOperationKey_(intent.payload) ||
      !intent.rowFingerprint || !['PUBLISHING', 'ACKNOWLEDGED'].includes(intent.state) ||
      !Number.isFinite(Date.parse(intent.startedAt)) ||
      (intent.state === 'ACKNOWLEDGED' && !intent.remoteId)) {
    throw new Error('Malformed Buffer intent; review required.');
  }
  return intent;
}

function readBufferPostsForReconciliation_(apiKey, channelIds) {
  const org = PropertiesService.getScriptProperties().getProperty(SOCIAL_CONFIG_.BUFFER_ORG_PROPERTY);
  if (!org) throw new Error('Missing BUFFER_ORGANIZATION_ID; cannot reconcile safely.');
  const posts = [], seenIds = new Set(), seenCursors = new Set();
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const query = 'query InvictaReconcile { posts(first:50' +
      (cursor ? ',after:' + JSON.stringify(cursor) : '') +
      ',input:{organizationId:' + JSON.stringify(org) + ',filter:{channelIds:' +
      JSON.stringify(channelIds) + ',status:[draft,error,needs_approval,scheduled,sending,sent]}}) {' +
      ' edges { node { id text channelId status createdAt assets { source } } }' +
      ' pageInfo { hasNextPage endCursor } } }';
    const result = bufferGraphql_(apiKey, query, {}).posts;
    if (!result || !Array.isArray(result.edges) || !result.pageInfo ||
        typeof result.pageInfo.hasNextPage !== 'boolean') throw new Error('Incomplete Buffer reconciliation response.');
    result.edges.forEach(function(edge) {
      const post = edge && edge.node;
      if (!post || !post.id || !post.channelId || !Array.isArray(post.assets)) {
        throw new Error('Malformed Buffer post; cannot prove reconciliation.');
      }
      if (!seenIds.has(post.id)) { seenIds.add(post.id); posts.push(post); }
    });
    if (!result.pageInfo.hasNextPage) return posts;
    cursor = result.pageInfo.endCursor;
    if (!cursor || seenCursors.has(cursor)) throw new Error('Invalid Buffer pagination; review required.');
    seenCursors.add(cursor);
  }
  throw new Error('Buffer reconciliation exceeded bounded pagination; no create permitted.');
}

function matchingSocialBufferPosts_(posts, payload) {
  return posts.filter(function(post) {
    if (payload.sourceType && Array.isArray(payload.priorReceiptIds) && payload.priorReceiptIds.includes(String(post.id))) return false;
    if (String(post.channelId) !== payload.channelId || String(post.text || '') !== payload.text) return false;
    // V1 audit only: old journals are never converted into new publish operations.
    if (!payload.publicIds) return post.assets.length === 1 && String(post.assets[0].source || '') === payload.mediaUrl;
    if (post.assets.length !== payload.publicIds.length) return false;
    return post.assets.every(function(asset,index) {
      const url = String(asset.source || '');
      const prefix = 'https://res.cloudinary.com/' + payload.cloud + '/' +
        (payload.mediaType === 'Reel' ? 'video' : 'image') + '/upload/';
      if (url.indexOf(prefix) !== 0) return false;
      const path = url.slice(prefix.length).replace(/^v[0-9]+\//,'').replace(/\.(jpg|mp4)$/,'');
      return path === payload.publicIds[index];
    });
  });
}

function saveSocialBufferReceipt_(cell, intent, id) {
  const receipt = Object.assign({}, intent, {state:'ACKNOWLEDGED', remoteId:String(id)});
  // Save the receipt in the durable journal first. A failed value write remains recoverable.
  cell.setNote(JSON.stringify(receipt));
  SpreadsheetApp.flush();
  cell.setValue(String(id));
  SpreadsheetApp.flush();
  if (String(cell.getValue()) !== String(id)) throw new Error('Buffer receipt write did not persist.');
}

function createOrReconcileSocialPost_(queue, rowNumber, row, apiKey, channelId, text, media, service, options) {
  if (!(options && options.saveToDraft === true) &&
      PropertiesService.getScriptProperties().getProperty('SOCIAL_PUBLISHING_ENABLED') !== 'true') {
    throw new Error('Social publishing disabled.');
  }
  assertSocialSendRowUnchanged_(queue,rowNumber,row);
  const cell = queue.getRange(rowNumber,service === 'facebook' ? 14 : 15);
  const payload = socialMediaPayload_(row,channelId,text,media,options);
  if (!text.trim() || !payload.sourceHash || !payload.channelId) throw new Error('Malformed approved Buffer payload.');
  let intent = readSocialBufferIntent_(cell);
  if (intent && intent.operationKey !== socialOperationKey_(payload)) throw new Error('Buffer payload/channel changed; do not reuse an old operation.');
  const matches = matchingSocialBufferPosts_(readBufferPostsForReconciliation_(apiKey,[channelId]),payload);
  if (matches.length > 1) throw new Error('Multiple matching Buffer posts; owner review required.');
  if (matches.length === 1) {
    if (!payload.saveToDraft && ['draft','error','needs_approval'].includes(matches[0].status)) throw new Error('Matching Buffer draft/error is not a publication receipt; owner review required.');
    if (payload.saveToDraft && matches[0].status !== 'draft') throw new Error('Draft acceptance found a non-draft; no mutation permitted.');
    if (intent && intent.remoteId && String(intent.remoteId) !== String(matches[0].id)) throw new Error('Buffer receipt identity conflict; owner review required.');
    intent = intent || {kind:'INVICTA_BUFFER_INTENT_V2',payload:payload,operationKey:socialOperationKey_(payload),
      rowFingerprint:socialRowFingerprint_(row),state:'PUBLISHING',startedAt:new Date().toISOString()};
    assertSocialSendRowUnchanged_(queue,rowNumber,row);
    saveSocialBufferReceipt_(cell,intent,matches[0].id);
    return {id:matches[0].id,reconciled:true};
  }
  if (intent || (options && options.reconcileOnly) || /Buffer (send failed|RECONCILE|PUBLISHING)/i.test(String(row[18] || ''))) {
    throw new Error('Uncertain previous create has no provable remote match; manual review, NOT another create.');
  }
  assertSocialMediaCurrent_(queue,rowNumber,row,media.plan);
  intent = {kind:'INVICTA_BUFFER_INTENT_V2',payload:payload,operationKey:socialOperationKey_(payload),
    rowFingerprint:socialRowFingerprint_(row),state:'PUBLISHING',startedAt:new Date().toISOString()};
  cell.setNote(JSON.stringify(intent));
  queue.getRange(rowNumber,13).setValue('Error');
  queue.getRange(rowNumber,19).setValue('Buffer PUBLISHING — durable intent saved; reconcile before retry.');
  SpreadsheetApp.flush();
  if (cell.getNote() !== JSON.stringify(intent) || queue.getRange(rowNumber,13).getValue() !== 'Error') throw new Error('Publishing intent did not persist; remote create blocked.');
  // Includes edits, archive, authoritative source stock, Airtable controls, and ordered Photos.
  assertSocialMediaCurrent_(queue,rowNumber,row,media.plan);
  const post = createBufferImagePost_(apiKey,channelId,text,media,service,options);
  // Persist the accepted receipt even if stock/UI changes after the remote call.
  // Subsequent channel still revalidates; never lose evidence of a successful create.
  saveSocialBufferReceipt_(cell,intent,post.id);
  return post;
}

/** Read-only production audit: never calls a Buffer mutation or changes queue rows. */
function auditSocialBufferQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another maintenance/social run is active.');
  try {
    const props = PropertiesService.getScriptProperties();
    const channels = [props.getProperty(SOCIAL_CONFIG_.BUFFER_FB_CHANNEL_PROPERTY),
      props.getProperty(SOCIAL_CONFIG_.BUFFER_IG_CHANNEL_PROPERTY)];
    const apiKey = props.getProperty(SOCIAL_CONFIG_.BUFFER_API_KEY_PROPERTY);
    if (!apiKey || channels.some(function(x) { return !x; })) throw new Error('Buffer configuration incomplete.');
    const queue = getSocialQueueSheetOrThrow_(SpreadsheetApp.getActiveSpreadsheet());
    assertSocialQueueHeaders_(queue);
    const posts = readBufferPostsForReconciliation_(apiKey, channels);
    const rows = queue.getLastRow() > 1 ? queue.getRange(2,1,queue.getLastRow()-1,19).getValues() : [];
    const summary = {rows:0, statuses:{}, rowsWithIds:0, remotePosts:posts.length,
      ready:[], review:[], duplicates:[]};
    const groups = new Map();
    posts.forEach(function(post) {
      const fingerprint = socialOperationKey_([post.channelId,post.text,post.assets.map(function(a){return a.source;})]);
      if (!groups.has(fingerprint)) groups.set(fingerprint,[]);
      groups.get(fingerprint).push(post.id);
    });
    groups.forEach(function(ids) { if (ids.length > 1) summary.duplicates.push(ids); });
    rows.forEach(function(row, index) {
      if (!row[0]) return;
      summary.rows++;
      const status = String(row[12] || '').trim();
      summary.statuses[status] = (summary.statuses[status] || 0) + 1;
      if (row[13] || row[14]) summary.rowsWithIds++;
      const evidence = {productKey:String(row[0]), rowNumber:index+2, status:status, channels:[]};
      ['facebook','instagram'].forEach(function(service, side) {
        const caption = String(row[side ? 10 : 9] || '').trim();
        const tags = String(row[11] || '').trim();
        const text = caption + (tags ? '\n\n' + tags : '');
        const intent = readSocialBufferIntent_(queue.getRange(index+2,14+side));
        const matches = matchingSocialBufferPosts_(posts, intent ? intent.payload :
          {channelId:channels[side],text:text,mediaUrl:String(row[4] || '').trim()});
        const savedId = String(row[13+side] || '').trim();
        evidence.channels.push({service:service, savedId:savedId,
          savedIdFound:!!savedId && posts.some(function(p){return p.id===savedId && p.channelId===channels[side];}),
          matches:matches.map(function(p){return {id:p.id,status:p.status};})});
      });
      if (status === 'Ready') summary.ready.push(evidence);
      if (/Buffer (send failed|RECONCILE|PUBLISHING)/i.test(String(row[18] || '')) ||
          evidence.channels.some(function(c){return (c.savedId && !c.savedIdFound) || c.matches.length>1;}) ||
          (status==='Queued' && (!row[13] || !row[14]))) summary.review.push(evidence);
    });
    console.log('Read-only Buffer queue audit: ' + JSON.stringify(summary));
    return summary;
  } finally { lock.releaseLock(); }
}

/**
   * Creates one Buffer image post. Only the guarded sender calls this for real queue rows.
 */
function createBufferImagePost_(apiKey,channelId,text,media,service,options) {
  const input = socialBufferInput_(channelId,text,media,service,options);
  const data = bufferGraphql_(apiKey,
    'mutation CreatePost($input: CreatePostInput!) { createPost(input: $input) { ... on PostActionSuccess { post { id dueAt } } ... on MutationError { message } } }',
    {input:input});
  const result = data.createPost;
  // Do not persist raw remote error text: it can contain signed URLs/credentials.
  if (!result || result.message || !result.post || !result.post.id) throw new Error('Buffer create did not return a confirmed receipt; reconcile before retry.');
  return result.post;
}


/**
 * Shared Buffer GraphQL helper.
 */
function bufferGraphql_(apiKey, query, variables) {
  let response;
  try {
    response = UrlFetchApp.fetch(SOCIAL_CONFIG_.BUFFER_ENDPOINT, {
      method:'post', contentType:'application/json',
      headers:{Authorization:'Bearer ' + apiKey},
      payload:JSON.stringify({query:query,variables:variables || {}}),
      muteHttpExceptions:true
    });
  } catch (_) {
    throw new Error('Buffer transport failed; reconcile before retry.');
  }
  const statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error('Buffer API HTTP ' + statusCode + '; reconcile before retry.');
  }
  let parsed;
  try { parsed = JSON.parse(response.getContentText()); }
  catch (_) { throw new Error('Malformed Buffer response; reconcile before retry.'); }
  if (!parsed || parsed.errors && parsed.errors.length) {
    throw new Error('Buffer GraphQL rejected operation; reconcile before retry.');
  }
  // Never include raw response/error messages; they may contain credentials/URLs.
  return parsed.data || {};
}


/**
 * Reads Website Export using HEADER NAMES,
 * not fixed column positions.
 */
function readSocialExportMap_(
  exportSheet
) {

  const retiredKeys = archivedCatalogKeys_(SpreadsheetApp.getActiveSpreadsheet());

  const lastRow =
    exportSheet.getLastRow();


  const lastColumn =
    exportSheet.getLastColumn();


  const map =
    new Map();


  if (lastRow < 2) {
    return map;
  }


  const data =
    exportSheet
      .getRange(
        1,
        1,
        lastRow,
        lastColumn
      )
      .getDisplayValues();


  const headers = buildHeaderMap_(data[0]);
  function col(name) {
    if (headers[name] === undefined) throw new Error('Website Export missing required header: ' + name);
    return headers[name];
  }

  const c = {

    key:
      col(
        'PRODUCT KEY'
      ),

    name:
      col(
        'DISPLAY NAME'
      ),

    category:
      col(
        'CATEGORY'
      ),

    quantity:
      col(
        'QUANTITY AVAILABLE'
      ),

    unitType:
      col(
        'UNIT TYPE'
      ),

    price:
      col(
        'WEBSITE PRICE'
      ),

    description:
      col(
        'DESCRIPTION'
      ),

    highlights:
      col(
        'HIGHLIGHTS'
      ),

    post:
      col(
        'POST TO WEBSITE'
      ),

    inStock:
      col(
        'IN STOCK'
      )
  };


  for (
    let i = 1;
    i < data.length;
    i++
  ) {

    const row =
      data[i];


    const productKey =
      String(
        row[c.key] || ''
      ).trim();


    if (!productKey || retiredKeys.has(normalizeKey_(productKey))) {
      continue;
    }


    const category =
      String(
        row[c.category] ||
        ''
      ).trim();


    const priceRaw =
      String(
        row[c.price] ||
        ''
      ).trim();


    const unitType =
      String(
        row[c.unitType] ||
        ''
      ).trim();


    if (map.has(productKey)) throw new Error('Duplicate Website Export Product Key: ' + productKey);
    map.set(
      productKey,
      {

        productKey:
          productKey,

        displayName:
          String(
            row[c.name] ||
            ''
          ).trim(),

        category:
          category,

        quantity:
          String(
            row[c.quantity] ||
            ''
          ).trim(),

        unitType:
          unitType,

        priceLabel:
          buildSocialPriceLabel_(
            priceRaw,
            category,
            unitType
          ),

        description:
          String(
            row[c.description] ||
            ''
          ).trim(),

        highlights:
          String(
            row[c.highlights] ||
            ''
          ).trim(),

        eligible:
          socialTruthy_(
            row[c.post]
          ) &&
          socialTruthy_(
            row[c.inStock]
          )
      }
    );
  }


  return map;
}


/**
 * Preserve website price semantics.
 */
function buildSocialPriceLabel_(
  priceRaw,
  category,
  unitType
) {

  const value =
    String(
      priceRaw || ''
    ).trim();


  if (!value) {
    return '';
  }


  const clean =
    value.charAt(0) === '$'
      ? value
      : '$' + value;


  if (
    String(
      category || ''
    ).trim() ===
    'Flooring'
  ) {

    return (
      clean +
      '/sq ft'
    );
  }


  if (
    String(
      unitType || ''
    )
      .trim()
      .toLowerCase() ===
    'box'
  ) {

    return (
      clean +
      '/box'
    );
  }


  return clean;
}


/**
 * Hash the verified source facts used
 * to create social copy.
 *
 * If these facts change later,
 * Ready -> Buffer is blocked.
 */
function buildSocialSourceHash_(source) {
  return socialOperationKey_([source.productKey,source.displayName,source.category,source.priceLabel,
    source.description,source.highlights,(source.photos || []).map(function(photo) { return photo.id; }),
    source.renderFacts || null,source.eligible ? '1' : '0']).slice(0,24);
}


/**
 * Convert common Sheet booleans
 * into true/false.
 */
function socialTruthy_(
  value
) {

  const normalized =
    String(
      value || ''
    )
      .trim()
      .toLowerCase();


  return (
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === '1' ||
    normalized === 'y'
  );
}


/**
 * Social Queue must already exist.
 * We deliberately don't auto-create
 * schema from Apps Script.
 */
function getSocialQueueSheetOrThrow_(
  spreadsheet
) {

  const sheet =
    spreadsheet.getSheetByName(
      SOCIAL_CONFIG_
        .QUEUE_SHEET
    );


  if (!sheet) {

    throw new Error(
      'Required sheet missing: "' +
      SOCIAL_CONFIG_
        .QUEUE_SHEET +
      '".'
    );
  }


  return sheet;
}


/**
 * Fail safely if someone later
 * changes/reorders the Social Queue schema.
 */
function assertSocialQueueHeaders_(
  sheet
) {

  const actual =
    sheet
      .getRange(
        1,
        1,
        1,
        SOCIAL_REQUIRED_HEADERS_
          .length
      )
      .getDisplayValues()[0];


  SOCIAL_REQUIRED_HEADERS_
    .forEach(
      function(
        expected,
        index
      ) {

        if (
          String(
            actual[index] ||
            ''
          )
            .trim()
            .toUpperCase() !==
          expected
        ) {

          throw new Error(
            'Social Queue header mismatch at column ' +
            (index + 1) +
            ': expected "' +
            expected +
            '".'
          );
        }
      }
    );
}


/**
 * Extract Gemini text from
 * Interactions API response.
 */
function extractSocialGeminiText_(
  value
) {

  const textParts = [];


  function walk(node) {

    if (!node) {
      return;
    }


    if (
      Array.isArray(node)
    ) {

      node.forEach(
        walk
      );

      return;
    }


    if (
      typeof node !==
      'object'
    ) {
      return;
    }


    if (
      node.type === 'text' &&
      typeof node.text ===
        'string'
    ) {

      textParts.push(
        node.text
      );

    } else if (

      node.type ===
        'model_output' &&

      typeof node.output_text ===
        'string'

    ) {

      textParts.push(
        node.output_text
      );
    }


    Object.keys(node)
      .forEach(
        function(key) {

          if (
            key !==
            'annotations'
          ) {

            walk(
              node[key]
            );
          }
        }
      );
  }


  walk(value);


  return textParts
    .join('\n')
    .trim();
}


/**
 * Parse Gemini JSON safely.
 */
function parseSocialGeminiJson_(
  text
) {

  const cleaned =
    String(
      text || ''
    )
      .replace(
        /^\s*```(?:json)?/i,
        ''
      )
      .replace(
        /```\s*$/i,
        ''
      )
      .trim();


  const start =
    cleaned.indexOf(
      '{'
    );


  const end =
    cleaned.lastIndexOf(
      '}'
    );


  if (
    start < 0 ||
    end <= start
  ) {

    throw new Error(
      'Gemini social output did not contain a JSON object.'
    );
  }


  return JSON.parse(
    cleaned.slice(
      start,
      end + 1
    )
  );
}


/**
 * Escape organization ID before
 * inserting into GraphQL query.
 */
function escapeGraphqlString_(
  value
) {

  return String(
    value || ''
  )
    .replace(
      /\\/g,
      '\\\\'
    )
    .replace(
      /"/g,
      '\\"'
    )
    .replace(
      /\r/g,
      '\\r'
    )
    .replace(
      /\n/g,
      '\\n'
    );
}
function runDailySocialPreparation() {
  const runStartedAt = new Date();
  const syncResult = syncSocialQueueFromCatalog();

  // Generate up to GEMINI_BATCH_SIZE new/changed captions every day.
  // Existing generated Drafts do NOT block generation.
  // Rows marked Ready, Skip, Queued, Error, or Needs Image are not
  // regenerated unless the existing generator explicitly considers them eligible.
  const captionResult = generateSocialCaptions();

  const generatedCount =
    captionResult && Number(captionResult.generated || 0);

  // Capture only the products generated by THIS run so the review email
  // lists today's new drafts rather than older Draft rows.
  const generatedProducts = findSocialProductsGeneratedSince_(runStartedAt);

  sendSocialReviewEmail_({
    subject: generatedCount
      ? 'Invicta social drafts ready for review (' + generatedCount + ')'
      : 'Invicta daily social preparation complete — no new drafts',
    heading: generatedCount
      ? generatedCount + ' new Invicta social draft' + (generatedCount === 1 ? ' is' : 's are') + ' ready.'
      : 'Invicta daily social preparation completed.',
    productName: '',
    productNames: generatedProducts,
    status: generatedCount ? 'Draft' : '',
    note: generatedCount
      ? 'Review the new drafts in Social Queue. Change good posts to Ready. Change products you do not want promoted to Skip. Drafts can remain for later review and will not block tomorrow\'s Gemini generation.'
      : 'No eligible new product captions were generated today. Existing Drafts remain available for review; use Ready to approve or Skip to exclude a product.'
  });

  const result = {
    sync: syncResult,
    captions: captionResult,
    generatedCount: generatedCount
  };

  console.log(JSON.stringify(result));
  return result;
}

function findSocialProductsGeneratedSince_(since) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Social Queue');
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(h) { return String(h).trim().toUpperCase(); });
  const nameCol = headers.indexOf('PRODUCT NAME');
  const generatedAtCol = headers.indexOf('GENERATED AT');
  if (nameCol < 0 || generatedAtCol < 0) return [];

  const sinceMs = since instanceof Date ? since.getTime() : new Date(since).getTime();
  return values.slice(1).filter(function(row) {
    if (!row[generatedAtCol]) return false;
    const generatedMs = new Date(row[generatedAtCol]).getTime();
    return !isNaN(generatedMs) && generatedMs >= sinceMs;
  }).map(function(row) {
    return String(row[nameCol] || '').trim();
  }).filter(Boolean);
}


function sendSocialReviewEmail_(details) {
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty('SOCIAL_REVIEW_EMAIL');

  if (!email) {
    throw new Error(
      'Missing Script Property SOCIAL_REVIEW_EMAIL. Add your review email address before enabling the daily social trigger.'
    );
  }

  const spreadsheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();

  const productLine = details.productName
    ? '<p><strong>Product:</strong> ' + escapeSocialEmailHtml_(details.productName) + '</p>'
    : '';

  const statusLine = details.status
    ? '<p><strong>Status:</strong> ' + escapeSocialEmailHtml_(details.status) + '</p>'
    : '';

  const productNames = Array.isArray(details.productNames) ? details.productNames.filter(Boolean) : [];
  const productListHtml = productNames.length
    ? '<p><strong>Products generated today:</strong></p><ul>' +
      productNames.map(function(name) { return '<li>' + escapeSocialEmailHtml_(name) + '</li>'; }).join('') +
      '</ul>'
    : '';
  const productListText = productNames.length
    ? 'Products generated today:\n' + productNames.map(function(name) { return '- ' + name; }).join('\n') + '\n\n'
    : '';

  const htmlBody =
    '<div style="font-family:Arial,sans-serif;line-height:1.5">' +
      '<h2>' + escapeSocialEmailHtml_(details.heading) + '</h2>' +
      productLine +
      statusLine +
      productListHtml +
      '<p>' + escapeSocialEmailHtml_(details.note) + '</p>' +
      '<p><a href="' + spreadsheetUrl + '">Open Invicta Social Queue</a></p>' +
      '<p>After review, set <strong>SOCIAL STATUS</strong> to <strong>Ready</strong> to approve or <strong>Skip</strong> to exclude the product.</p>' +
    '</div>';

  MailApp.sendEmail({
    to: email,
    subject: details.subject,
    htmlBody: htmlBody,
    body:
      details.heading + '\n\n' +
      (details.productName ? 'Product: ' + details.productName + '\n' : '') +
      (details.status ? 'Status: ' + details.status + '\n' : '') +
      '\n' + productListText + details.note +
      '\n\nOpen Social Queue: ' + spreadsheetUrl +
      '\n\nAfter review, set SOCIAL STATUS to Ready to approve or Skip to exclude the product.'
  });
}


function escapeSocialEmailHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function setupDailySocialTriggers() {
  // Installing preparation triggers also enables unattended Gemini/email work.
  // Keep the entire social schedule opt-in, not just the Buffer sender.
  if (PropertiesService.getScriptProperties().getProperty('SOCIAL_PUBLISHING_ENABLED') !== 'true') {
    throw new Error('Social automation is disabled; explicit owner activation is required before installing triggers.');
  }
  const preparationHandlers = [
    'runDailySocialPreparation',
    // Legacy handler name retained only so setup can remove any stale old trigger.
    'runWednesdaySocialPreparation'
  ];
  const publishingHandler = 'sendReadySocialPostsToBuffer';

  // Remove only social triggers managed by this setup function.
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    const handler = trigger.getHandlerFunction();
    if (preparationHandlers.indexOf(handler) >= 0 ||
        handler === publishingHandler) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Prepare up to 5 Gemini drafts every day during the 6-7 AM Central window.
  // Apps Script time-based triggers run within the selected hour rather than
  // at an exact minute, so the review email should arrive by roughly 7 AM.
  ScriptApp.newTrigger('runDailySocialPreparation')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .inTimezone('America/Chicago')
    .create();

  // Morning Ready-to-Buffer check during the 9-10 AM Central window.
  ScriptApp.newTrigger(publishingHandler)
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .inTimezone('America/Chicago')
    .create();

  // Evening fallback during the 5-6 PM Central window. This catches a Ready
  // product approved after the morning check. The same rolling 48-hour gate in
  // sendReadySocialPostsToBuffer() prevents a second product from being queued
  // if the morning run already sent one.
  ScriptApp.newTrigger(publishingHandler)
    .timeBased()
    .everyDays(1)
    .atHour(17)
    .inTimezone('America/Chicago')
    .create();

  console.log(
    'Social triggers created: Gemini preparation ~6-7 AM Central; ' +
    'Ready-to-Buffer checks ~9-10 AM and ~5-6 PM Central; ' +
    'rolling 48-hour posting gate remains active.'
  );
}


function hasSocialPostQueuedWithinHours_(hours) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Social Queue');
  if (!sheet || sheet.getLastRow() < 2) return false;
  assertSocialQueueHeaders_(sheet);
  const values = sheet.getRange(2,1,sheet.getLastRow()-1,19).getValues();
  const cutoff = Date.now() - Number(hours)*3600000;
  return values.some(function(row,index) {
    // Any accepted/uncertain hand-off counts, even after a Skip or partial failure.
    if (row[15] && Number.isFinite(new Date(row[15]).getTime()) && new Date(row[15]).getTime() > cutoff) return true;
    return [14,15].some(function(column) {
      const intent = readSocialBufferIntent_(sheet.getRange(index+2,column));
      return !!intent && Date.parse(intent.startedAt) > cutoff;
    });
  });
}
