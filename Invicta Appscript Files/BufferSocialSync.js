/**
 * Invicta Home Supply — Social Queue + Gemini + Buffer automation
 *
 * Flow:
 * Website Export
 *   -> Social Queue
 *   -> Gemini social copy
 *   -> Manual Ready approval
 *   -> Buffer Facebook + Instagram queues
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
 * V1 intentionally auto-publishes IMAGE POSTS only.
 * Reel/video rows can receive Gemini copy, but Reel/video
 * publishing remains manual.
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
 * Existing captions, approval status, manually
 * supplied media URLs, and Buffer IDs are preserved.
 *
 * Rows are never automatically deleted.
 */
function syncSocialQueueFromCatalog() {

  const lock =
    LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another Apps Script maintenance/social run is active.'
    );
  }

  try {

    const ss =
      SpreadsheetApp.getActiveSpreadsheet();

    const queue =
      getSocialQueueSheetOrThrow_(ss);

    const exportSheet =
      getInventorySheetOrThrow_(
        ss,
        SOCIAL_CONFIG_.EXPORT_SHEET
      );

    assertSocialQueueHeaders_(queue);

    const sourceMap =
      readSocialSourceMap_(exportSheet);

    const lastQueueRow =
      getLastDataRowInColumn_(
        queue,
        SOCIAL_COLUMNS_.PRODUCT_KEY
      );

    const existingRows =
      lastQueueRow >= 2
        ? queue
            .getRange(
              2,
              1,
              lastQueueRow - 1,
              SOCIAL_COLUMNS_.ERROR
            )
            .getValues()
        : [];

    const rowByKey =
      new Map();

    existingRows.forEach(
      function(row, index) {

        const key =
          String(
            row[
              SOCIAL_COLUMNS_.PRODUCT_KEY - 1
            ] || ''
          ).trim();

        if (key) {
          rowByKey.set(
            key,
            {
              rowNumber:
                index + 2,

              values:
                row
            }
          );
        }
      }
    );


    let added = 0;
    let refreshed = 0;
    let needsCopy = 0;

    const appendRows = [];


    sourceMap.forEach(
      function(
        source,
        productKey
      ) {

        if (!source.eligible) {
          return;
        }

        const currentHash =
          buildSocialSourceHash_(
            source
          );

        const existing =
          rowByKey.get(
            productKey
          );

        const ownProductUrl =
          SOCIAL_CONFIG_
            .WEBSITE_BASE_URL +
          encodeURIComponent(
            productKey
          );


        /*
         * NEW PRODUCT
         */
        if (!existing) {

          appendRows.push([
            productKey,
            source.displayName,
            source.category,
            source.priceLabel,
            source.stockImageUrl,
            'Image',
            ownProductUrl,
            'Post',
            '',
            '',
            '',
            '',
            source.stockImageUrl
              ? 'Draft'
              : 'Needs Image',
            '',
            '',
            '',
            '',
            currentHash,
            ''
          ]);

          added++;

          return;
        }


        /*
         * EXISTING PRODUCT
         */
        const row =
          existing.values.slice();

        const oldHash =
          String(
            row[
              SOCIAL_COLUMNS_
                .SOURCE_HASH - 1
            ] || ''
          );

        const oldStatus =
          String(
            row[
              SOCIAL_COLUMNS_
                .SOCIAL_STATUS - 1
            ] || ''
          ).trim();

        const hasCopy =
          Boolean(
            String(
              row[
                SOCIAL_COLUMNS_
                  .FACEBOOK_CAPTION - 1
              ] || ''
            ).trim() ||

            String(
              row[
                SOCIAL_COLUMNS_
                  .INSTAGRAM_CAPTION - 1
              ] || ''
            ).trim()
          );


        /*
         * Source-owned fields
         */
        row[
          SOCIAL_COLUMNS_
            .PRODUCT_NAME - 1
        ] =
          source.displayName;

        row[
          SOCIAL_COLUMNS_
            .CATEGORY - 1
        ] =
          source.category;

        row[
          SOCIAL_COLUMNS_
            .PRICE - 1
        ] =
          source.priceLabel;

        row[
          SOCIAL_COLUMNS_
            .PRODUCT_URL - 1
        ] =
          ownProductUrl;


        /*
         * Preserve manually supplied
         * media URL.
         *
         * Only fill if blank.
         */
        if (
          !String(
            row[
              SOCIAL_COLUMNS_
                .MEDIA_URL - 1
            ] || ''
          ).trim() &&

          source.stockImageUrl
        ) {

          row[
            SOCIAL_COLUMNS_
              .MEDIA_URL - 1
          ] =
            source.stockImageUrl;

          if (
            oldStatus ===
            'Needs Image'
          ) {

            row[
              SOCIAL_COLUMNS_
                .SOCIAL_STATUS - 1
            ] =
              'Draft';
          }
        }


        if (
          !String(
            row[
              SOCIAL_COLUMNS_
                .MEDIA_TYPE - 1
            ] || ''
          ).trim()
        ) {

          row[
            SOCIAL_COLUMNS_
              .MEDIA_TYPE - 1
          ] =
            'Image';
        }


        if (
          !String(
            row[
              SOCIAL_COLUMNS_
                .CONTENT_TYPE - 1
            ] || ''
          ).trim()
        ) {

          row[
            SOCIAL_COLUMNS_
              .CONTENT_TYPE - 1
          ] =
            'Post';
        }


        /*
         * If verified product facts changed
         * after copy was generated,
         * require fresh copy.
         */
        if (
          oldHash &&
          oldHash !== currentHash &&
          hasCopy &&
          oldStatus !== 'Queued' &&
          oldStatus !== 'Skip'
        ) {

          row[
            SOCIAL_COLUMNS_
              .SOCIAL_STATUS - 1
          ] =
            'Needs Copy';

          row[
            SOCIAL_COLUMNS_
              .ERROR - 1
          ] =
            'Product facts changed after social copy was generated.';

          needsCopy++;
        }


        row[
          SOCIAL_COLUMNS_
            .SOURCE_HASH - 1
        ] =
          currentHash;


        queue
          .getRange(
            existing.rowNumber,
            1,
            1,
            SOCIAL_COLUMNS_.ERROR
          )
          .setValues([row]);

        refreshed++;
      }
    );


    /*
     * Append new products
     */
    if (appendRows.length) {

      queue
        .getRange(
          queue.getLastRow() + 1,
          1,
          appendRows.length,
          SOCIAL_COLUMNS_.ERROR
        )
        .setValues(
          appendRows
        );
    }


    const summary = {
      added: added,
      refreshed: refreshed,
      needsCopy: needsCopy
    };

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


        const mediaUrl =
          String(
            row[
              SOCIAL_COLUMNS_
                .MEDIA_URL - 1
            ] ||
            source.stockImageUrl ||
            ''
          ).trim();


        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .SOCIAL_STATUS
          )
          .setValue(
            mediaUrl
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
 * Buffer uses addToQueue, therefore Buffer
 * chooses the next configured publishing time.
 *
 * V1 supports IMAGE POSTS ONLY.
 */
function sendReadySocialPostsToBuffer() {

  const props =
    PropertiesService
      .getScriptProperties();


  const apiKey =
    props.getProperty(
      SOCIAL_CONFIG_
        .BUFFER_API_KEY_PROPERTY
    );


  const fbChannelId =
    props.getProperty(
      SOCIAL_CONFIG_
        .BUFFER_FB_CHANNEL_PROPERTY
    );


  const igChannelId =
    props.getProperty(
      SOCIAL_CONFIG_
        .BUFFER_IG_CHANNEL_PROPERTY
    );


  if (
    !apiKey ||
    !fbChannelId ||
    !igChannelId
  ) {

    throw new Error(
      'Buffer is not configured. ' +
      'Add BUFFER_API_KEY and run setupBufferChannels() first.'
    );
  }


  /*
   * Prevent overlapping social runs.
   */
  const lock =
    LockService.getScriptLock();


  if (!lock.tryLock(30000)) {

    throw new Error(
      'Another Apps Script maintenance/social run is active.'
    );
  }


  const summary = {
    processed: 0,
    queued: 0,
    partial: 0,
    failed: 0,
    skipped: false,
    reason: ''
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


    /*
 * EVERY-OTHER-DAY SAFETY GATE
 *
 * Allow at most one automated product to be queued
 * during any rolling 48-hour window.
 */
if (
  hasSocialPostQueuedWithinHours_(48)
) {

  summary.skipped = true;

  summary.reason =
    'A social product post was queued within the last 48 hours.';

  console.log(
    JSON.stringify(
      summary
    )
  );

  return summary;
}


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

      console.log(
        JSON.stringify(
          summary
        )
      );

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


    /*
     * Process AT MOST ONE Ready product.
     *
     * This is intentionally independent
     * of BUFFER_BATCH_SIZE.
     */
    for (
      let i = 0;
      i < rows.length;
      i++
    ) {

      const row =
        rows[i];


      const status =
        String(
          row[
            SOCIAL_COLUMNS_
              .SOCIAL_STATUS - 1
          ] || ''
        ).trim();


      if (
        status !== 'Ready'
      ) {
        continue;
      }


      /*
       * We found our one candidate
       * for this run.
       */
      summary.processed = 1;


      const rowNumber =
        i + 2;


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


      /*
       * Recheck current Website Export
       * eligibility immediately before
       * sending anything to Buffer.
       */
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
            SOCIAL_COLUMNS_
              .ERROR
          )
          .setValue(
            'Blocked before Buffer: product is no longer eligible/in stock in Website Export.'
          );


        summary.failed++;

        break;
      }


      /*
       * Verify that the product facts
       * have not changed since Gemini
       * generated the approved copy.
       */
      const currentHash =
        buildSocialSourceHash_(
          source
        );


      const approvedHash =
        String(
          row[
            SOCIAL_COLUMNS_
              .SOURCE_HASH - 1
          ] || ''
        );


      if (
        !approvedHash ||
        approvedHash !== currentHash
      ) {

        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .SOCIAL_STATUS
          )
          .setValue(
            'Needs Copy'
          );


        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .ERROR
          )
          .setValue(
            'Blocked before Buffer: product facts changed since caption generation.'
          );


        summary.failed++;

        break;
      }


      const mediaUrl =
        String(
          row[
            SOCIAL_COLUMNS_
              .MEDIA_URL - 1
          ] || ''
        ).trim();


      const mediaType =
        String(
          row[
            SOCIAL_COLUMNS_
              .MEDIA_TYPE - 1
          ] || 'Image'
        ).trim();


      const contentType =
        String(
          row[
            SOCIAL_COLUMNS_
              .CONTENT_TYPE - 1
          ] || 'Post'
        ).trim();


      const facebookCaption =
        String(
          row[
            SOCIAL_COLUMNS_
              .FACEBOOK_CAPTION - 1
          ] || ''
        ).trim();


      const instagramCaption =
        String(
          row[
            SOCIAL_COLUMNS_
              .INSTAGRAM_CAPTION - 1
          ] || ''
        ).trim();


      const hashtagBlock =
        String(
          row[
            SOCIAL_COLUMNS_
              .HASHTAGS - 1
          ] || ''
        ).trim();


      /*
       * Require image + both approved
       * captions before Buffer.
       */
      if (
        !mediaUrl ||
        !facebookCaption ||
        !instagramCaption
      ) {

        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .SOCIAL_STATUS
          )
          .setValue(
            mediaUrl
              ? 'Needs Copy'
              : 'Needs Image'
          );


        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .ERROR
          )
          .setValue(
            'Blocked before Buffer: media and both approved captions are required.'
          );


        summary.failed++;

        break;
      }


      /*
       * V1 deliberately publishes only
       * standard image Posts.
       *
       * Reels/videos remain manual.
       */
      if (
        contentType !== 'Post' ||
        mediaType !== 'Image'
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
            SOCIAL_COLUMNS_
              .ERROR
          )
          .setValue(
            'V1 only auto-publishes image Posts. ' +
            'Reel/video creation remains manual.'
          );


        summary.failed++;

        break;
      }


      /*
       * Existing IDs are preserved so a
       * partial Facebook/Instagram failure
       * can be retried without creating a
       * duplicate on the successful side.
       */
      let fbId =
        String(
          row[
            SOCIAL_COLUMNS_
              .FB_BUFFER_POST_ID - 1
          ] || ''
        ).trim();


      let igId =
        String(
          row[
            SOCIAL_COLUMNS_
              .IG_BUFFER_POST_ID - 1
          ] || ''
        ).trim();


      try {

        /*
         * FACEBOOK
         */
        if (!fbId) {

          const fbText =
            facebookCaption +
            (
              hashtagBlock
                ? '\n\n' +
                  hashtagBlock
                : ''
            );


          const fbPost =
            createBufferImagePost_(
              apiKey,
              fbChannelId,
              fbText,
              mediaUrl,
              'facebook'
            );


          fbId =
            fbPost.id;


          queue
            .getRange(
              rowNumber,
              SOCIAL_COLUMNS_
                .FB_BUFFER_POST_ID
            )
            .setValue(
              fbId
            );
        }


        /*
         * INSTAGRAM
         */
        if (!igId) {

          const igText =
            instagramCaption +
            (
              hashtagBlock
                ? '\n\n' +
                  hashtagBlock
                : ''
            );


          const igPost =
            createBufferImagePost_(
              apiKey,
              igChannelId,
              igText,
              mediaUrl,
              'instagram'
            );


          igId =
            igPost.id;


          queue
            .getRange(
              rowNumber,
              SOCIAL_COLUMNS_
                .IG_BUFFER_POST_ID
            )
            .setValue(
              igId
            );
        }


        /*
         * BOTH CHANNELS SUCCEEDED
         */
        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .SOCIAL_STATUS
          )
          .setValue(
            'Queued'
          );


        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .LAST_POSTED_AT
          )
          .setValue(
            new Date()
          );


        queue
          .getRange(
            rowNumber,
            SOCIAL_COLUMNS_
              .ERROR
          )
          .clearContent();


        summary.queued++;


      } catch (error) {

        /*
         * A successful channel ID remains
         * stored so retry will not duplicate it.
         */
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
            SOCIAL_COLUMNS_
              .ERROR
          )
          .setValue(
            'Buffer send failed: ' +
            String(
              error.message ||
              error
            ).slice(
              0,
              500
            )
          );


        if (
          fbId ||
          igId
        ) {

          summary.partial++;

        } else {

          summary.failed++;
        }
      }


      /*
       * Critical:
       *
       * Never process a second Ready
       * product in the same run.
       */
      break;
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



/*
 * Returns true when a product was
 * successfully sent to BOTH Buffer
 * channels during the previous N days.
 *
 * LAST POSTED AT is only written after
 * Facebook + Instagram both succeed.
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


/**
 * Creates one Buffer image post.
 */
function createBufferImagePost_(
  apiKey,
  channelId,
  text,
  mediaUrl,
  service
) {

  const input = {

  text:
    text,

  channelId:
    channelId,

  schedulingType:
    'automatic',

  mode:
    'addToQueue',

  aiAssisted:
    true,

  assets: [
    {
      image: {
        url:
          mediaUrl
      }
    }
  ],

  metadata:
    service === 'facebook'
      ? {
          facebook: {
            type: 'post'
          }
        }
      : service === 'instagram'
        ? {
            instagram: {
              type: 'post',
              shouldShareToFeed: true
            }
          }
        : undefined,

  source:
    'invicta-google-sheets'
};

  const query = [

    'mutation CreatePost($input: CreatePostInput!) {',

    '  createPost(input: $input) {',

    '    ... on PostActionSuccess {',

    '      post { id dueAt }',

    '    }',

    '    ... on MutationError {',

    '      message',

    '    }',

    '  }',

    '}'

  ].join('\n');


  const data =
    bufferGraphql_(
      apiKey,
      query,
      {
        input: input
      }
    );


  const result =
    data.createPost;


  if (!result) {

    throw new Error(
      'Buffer returned no createPost result for ' +
      service +
      '.'
    );
  }


  if (result.message) {

    throw new Error(
      service +
      ': ' +
      result.message
    );
  }


  if (
    !result.post ||
    !result.post.id
  ) {

    throw new Error(
      'Buffer did not return a post ID for ' +
      service +
      '.'
    );
  }


  return result.post;
}


/**
 * Shared Buffer GraphQL helper.
 */
function bufferGraphql_(
  apiKey,
  query,
  variables
) {

  const response =
    UrlFetchApp.fetch(
      SOCIAL_CONFIG_
        .BUFFER_ENDPOINT,
      {
        method:
          'post',

        contentType:
          'application/json',

        headers: {
          Authorization:
            'Bearer ' +
            apiKey
        },

        payload:
          JSON.stringify({
            query:
              query,

            variables:
              variables || {}
          }),

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
      'Buffer API HTTP ' +
      statusCode +
      ': ' +
      body.slice(
        0,
        500
      )
    );
  }


  const parsed =
    JSON.parse(
      body
    );


  if (
    parsed.errors &&
    parsed.errors.length
  ) {

    throw new Error(
      'Buffer GraphQL: ' +
      parsed.errors
        .map(
          function(error) {
            return error.message;
          }
        )
        .join(' | ')
    );
  }


  return parsed.data || {};
}


/**
 * Reads Website Export using HEADER NAMES,
 * not fixed column positions.
 */
function readSocialSourceMap_(
  exportSheet
) {

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


  const headers =
    data[0]
      .map(
        function(value) {

          return String(
            value || ''
          )
            .trim()
            .toUpperCase();
        }
      );


  function col(name) {

    const index =
      headers.indexOf(
        name
      );


    if (index < 0) {

      throw new Error(
        'Website Export missing required header: ' +
        name
      );
    }


    return index;
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

    image:
      col(
        'STOCK IMAGE URL'
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


    if (!productKey) {
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

        stockImageUrl:
          String(
            row[c.image] ||
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
function buildSocialSourceHash_(
  source
) {

  const input = [

    source.productKey,
    source.displayName,
    source.category,
    source.priceLabel,
    source.description,
    source.highlights,
    source.stockImageUrl,
    source.eligible
      ? '1'
      : '0'

  ].join('\n');


  const bytes =
    Utilities.computeDigest(
      Utilities
        .DigestAlgorithm
        .SHA_256,

      input,

      Utilities
        .Charset
        .UTF_8
    );


  return Utilities
    .base64EncodeWebSafe(
      bytes
    )
    .replace(
      /=+$/g,
      ''
    )
    .slice(
      0,
      24
    );
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
  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName('Social Queue');

  if (!sheet || sheet.getLastRow() < 2) {
    return false;
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(h) {
    return String(h).trim().toUpperCase();
  });

  const idx = {};
  headers.forEach(function(h, i) { idx[h] = i; });

  const statusCol = idx['SOCIAL STATUS'];
  const lastPostedCol = idx['LAST POSTED AT'];

  if (statusCol == null || lastPostedCol == null) {
    throw new Error(
      'Social Queue is missing SOCIAL STATUS or LAST POSTED AT.'
    );
  }

  const cutoffMs = Date.now() - (Number(hours) * 60 * 60 * 1000);

  for (let r = 1; r < values.length; r++) {
    const status = String(values[r][statusCol] || '').trim();
    const lastPostedAt = values[r][lastPostedCol];

    if (status !== 'Queued' || !lastPostedAt) {
      continue;
    }

    const postedDate = new Date(lastPostedAt);
    if (isNaN(postedDate.getTime())) {
      continue;
    }

    if (postedDate.getTime() > cutoffMs) {
      return true;
    }
  }

  return false;
}
