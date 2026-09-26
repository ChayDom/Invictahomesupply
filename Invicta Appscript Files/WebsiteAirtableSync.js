/**
 * Invicta Home Supply - Website Export to Airtable sync.
 *
 * Publishes only:
 *   POST TO WEBSITE = Yes
 *   AND
 *   IN STOCK = TRUE
 *
 * Core rules:
 * - Product Key is the permanent Airtable identity.
 * - Existing Airtable records that become ineligible are unpublished,
 *   never deleted.
 * - Existing Airtable Status is preserved.
 * - Existing Date Added is preserved.
 * - New records default to Status = In Stock.
 * - Only NEW or CHANGED records are written to Airtable.
 * - Unchanged records are skipped to reduce Airtable API usage.
 * - One invalid Website Export row does not abort the entire sync.
 * - A rejected row is not accidentally unpublished.
 * - Concurrent Airtable sync executions are prevented with LockService.
 */

const IWA_SYNC_HARDENED = {
  BASE_ID: 'apptugvm4r5tm2OIt',
  TABLE_NAME: 'Website Products',
  EXPORT_SHEET: 'Website Export',
  TOKEN_PROPERTY: 'AIRTABLE_TOKEN',

  BATCH_SIZE: 10,
  MIN_REQUEST_INTERVAL_MS: 220,
  MAX_ATTEMPTS: 5,
  LOCK_WAIT_MS: 30000
};


/**
 * Approved Airtable Website Category values.
 */
const IWA_H_CATEGORY_VALUES = [
  'Flooring',
  'Water Heaters',
  'Appliances',
  'Plumbing & Bath',
  'Lawn & Outdoor',
  'Tools',
  'Electrical & Lighting',
  'Electronics & Smart Home',
  'Paint & Supplies',
  'Building Materials',
  'Doors & Windows',
  'Heating & Cooling',
  'Home & Furniture',
  'Cleaning & Household',
  'Health & Personal Care',
  'Automotive',
  'Sports & Fitness',
  'Toys & Collectibles',
  'Other'
];


/**
 * Canonical Airtable Water Resistance values.
 *
 * Historical Website Export values "Yes" and "No"
 * are normalized later by iwaWaterResistance_().
 */
const IWA_H_WATER_RESISTANCE_VALUES = [
  'Waterproof',
  'Water Resistant',
  'Not Water Resistant',
  'Unknown'
];


/**
 * Approved Airtable Underlayment Attached values.
 */
const IWA_H_UNDERLAYMENT_VALUES = [
  'Yes',
  'No'
];


/**
 * Main Website Export -> Airtable synchronization.
 *
 * Normal scheduled/manual run:
 *
 *   syncWebsiteExportToAirtable()
 *
 * Optional controlled run:
 *
 *   syncWebsiteExportToAirtable({
 *     productKeys: ['HD-123', 'LOW-456']
 *   })
 */
function syncWebsiteExportToAirtable(options) {
  const opts = options || {};

  const lock =
    LockService.getScriptLock();

  if (
    !lock.tryLock(
      IWA_SYNC_HARDENED.LOCK_WAIT_MS
    )
  ) {
    const skipped = {
      skipped: true,
      reason:
        'Another Airtable sync is already running.'
    };

    console.log(
      JSON.stringify(skipped)
    );

    return skipped;
  }

  try {
    return syncWebsiteExportToAirtableLocked_(
      opts
    );
  } finally {
    lock.releaseLock();
  }
}


/**
 * Locked implementation.
 */
function syncWebsiteExportToAirtableLocked_(
  opts
) {
  /*
   * Reset per-run Airtable API counter.
   *
   * Every actual UrlFetchApp.fetch() attempt counts,
   * including retries.
   */
  iwaRequest_.callCount_ = 0;


  /*
   * Optional controlled Product Key set.
   */
  const requestedKeys =
    opts.productKeys
      ? new Set(
          opts.productKeys
            .map(function(value) {
              return iwaText_(value);
            })
            .filter(Boolean)
        )
      : null;


  const spreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();


  const sheet =
    spreadsheet.getSheetByName(
      IWA_SYNC_HARDENED.EXPORT_SHEET
    );


  if (!sheet) {
    throw new Error(
      'Required sheet missing: "' +
      IWA_SYNC_HARDENED.EXPORT_SHEET +
      '".'
    );
  }


  const values =
    sheet.getDataRange().getValues();


  if (values.length < 2) {
    console.log(
      'Website Export has no data rows.'
    );

    return {
      synced: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      unpublished: 0,
      approvedRows: 0,
      rejected: 0,
      airtableWriteRequests: 0,
      airtableApiCalls: 0,
      controlled: !!requestedKeys
    };
  }


  /*
   * Build header map.
   */
  const headers =
    values[0].map(function(value) {
      return iwaText_(value)
        .toUpperCase();
    });


  const H = {};


  headers.forEach(
    function(header, index) {
      if (header) {
        H[header] = index;
      }
    }
  );


  /*
   * Required Website Export contract.
   */
  const required = [
    'PRODUCT KEY',
    'DISPLAY NAME',
    'CATEGORY',
    'BRAND',
    'MODEL',
    'RETAIL SKU',
    'RETAILER',
    'QUANTITY AVAILABLE',
    'UNIT TYPE',
    'SQ FT PER UNIT',
    'AVAILABLE SQ FT',
    'WEBSITE PRICE',
    'DESCRIPTION',
    'HIGHLIGHTS',
    'PRODUCT URL',
    'STOCK IMAGE URL',
    'POST TO WEBSITE',
    'IN STOCK',
    'BOX PRICE',
    'SUBCATEGORY',
    'THICKNESS MM',
    'WEAR LAYER MIL',
    'UNDERLAYMENT ATTACHED',
    'WATER RESISTANCE',
    'CARD SPEC 1',
    'CARD SPEC 2',
    'CARD SPEC 3'
  ];


  const missing =
    required.filter(
      function(header) {
        return H[header] === undefined;
      }
    );


  if (missing.length > 0) {
    throw new Error(
      'Website Export is missing required column(s): ' +
      missing.join(', ')
    );
  }


  /*
   * Airtable API token.
   */
  const token =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        IWA_SYNC_HARDENED
          .TOKEN_PROPERTY
      );


  if (!token) {
    throw new Error(
      'Missing Script Property: ' +
      IWA_SYNC_HARDENED
        .TOKEN_PROPERTY
    );
  }


  /*
   * Fetch all current Airtable records.
   *
   * If the table remains under 100 records,
   * this normally consumes one Airtable GET request.
   */
  const existingRecords =
    iwaFetchAll_(token);


  const existingByKey =
    new Map();


  existingRecords.forEach(
    function(record) {
      const fields =
        record.fields || {};


      const key =
        iwaText_(
          fields['Product Key']
        );


      if (key) {
        existingByKey.set(
          key,
          record
        );
      }
    }
  );


  const today =
    Utilities.formatDate(
      new Date(),
      'America/Chicago',
      'yyyy-MM-dd'
    );


  /*
   * Only records in this array will be written.
   *
   * Unlike the previous implementation,
   * unchanged eligible products are NOT added here.
   */
  const recordsToWrite = [];


  /*
   * Eligible keys are used later to identify
   * previously published Airtable records that
   * should now be unpublished.
   */
  const eligibleKeys =
    new Set();


  /*
   * Invalid rows must not be interpreted as
   * intentionally removed/unpublished products.
   */
  const rejectedKeys =
    new Set();


  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;


  const invalid = {
    category: 0,
    waterResistance: 0,
    underlaymentAttached: 0
  };


  const rejectedRows = [];


  /*
   * Process Website Export rows.
   */
  values
    .slice(1)
    .forEach(
      function(row, index) {
        const sheetRow =
          index + 2;


        const key =
          iwaText_(
            row[H['PRODUCT KEY']]
          );


        if (!key) {
          return;
        }


        /*
         * Controlled/manual run.
         *
         * Ignore non-requested Product Keys.
         */
        if (
          requestedKeys &&
          !requestedKeys.has(key)
        ) {
          return;
        }


        const post =
          iwaBool_(
            row[
              H['POST TO WEBSITE']
            ]
          );


        const inStock =
          iwaBool_(
            row[H['IN STOCK']]
          );


        /*
         * Not currently eligible.
         *
         * Do not add to eligibleKeys.
         * Existing published Airtable record will
         * later be considered for unpublishing.
         */
        if (!post || !inStock) {
          return;
        }


        /*
         * Validate and build this product independently.
         *
         * One invalid product must not stop every
         * other Website Export product from syncing.
         */
        try {
          const categoryResult =
            iwaEnum_(
              row[H['CATEGORY']],
              IWA_H_CATEGORY_VALUES,
              'Category'
            );


          const waterResult =
            iwaWaterResistance_(
              row[
                H[
                  'WATER RESISTANCE'
                ]
              ]
            );


          const underResult =
            iwaEnum_(
              row[
                H[
                  'UNDERLAYMENT ATTACHED'
                ]
              ],
              IWA_H_UNDERLAYMENT_VALUES,
              'Underlayment Attached'
            );


          const category =
            categoryResult.value;


          const unitType =
            iwaText_(
              row[H['UNIT TYPE']]
            );


          const existingRecord =
            existingByKey.get(key);


          const existingFields =
            existingRecord
              ? existingRecord.fields || {}
              : {};


          /*
           * Preserve Date Added.
           *
           * Priority:
           * 1. Existing Airtable Date Added
           * 2. Airtable record createdTime
           * 3. Today's Central Time date for new records
           */
          const dateAdded =
            iwaNullableText_(
              existingFields[
                'Date Added'
              ]
            ) ||
            (
              existingRecord &&
              existingRecord.createdTime
                ? Utilities.formatDate(
                    new Date(
                      existingRecord
                        .createdTime
                    ),
                    'America/Chicago',
                    'yyyy-MM-dd'
                  )
                : today
            );


          /*
           * Preserve Airtable operational Status.
           *
           * Existing values such as:
           * - In Stock
           * - Reserved
           * - Sold Out
           * - Draft
           *
           * must not be overwritten by this sync.
           *
           * Only genuinely new records default
           * to "In Stock".
           */
          const status =
            existingRecord
              ? (
                  iwaNullableText_(
                    existingFields[
                      'Status'
                    ]
                  ) ||
                  'In Stock'
                )
              : 'In Stock';


          /*
           * Fields owned by Website Export -> Airtable sync.
           */
          const desiredFields = {
            'Product Key':
              key,


            'Name':
              iwaText_(
                row[
                  H['DISPLAY NAME']
                ]
              ) || key,


            'Category':
              category,


            'Brand':
              iwaNullableText_(
                row[H['BRAND']]
              ),


            'Model':
              iwaNullableText_(
                row[H['MODEL']]
              ),


            'Retail SKU':
              iwaNullableText_(
                row[
                  H['RETAIL SKU']
                ]
              ),


            'Retailer':
              iwaNullableText_(
                row[H['RETAILER']]
              ),


            'Price':
              iwaNumber_(
                row[
                  H['WEBSITE PRICE']
                ]
              ),


            'Price Basis':
              category === 'Flooring'
                ? 'Per Sq Ft'
                : unitType === 'Box'
                  ? 'Per Box'
                  : 'Each',


            'Box Price':
              iwaNumber_(
                row[H['BOX PRICE']]
              ),


            'Quantity Available':
              iwaNumber_(
                row[
                  H[
                    'QUANTITY AVAILABLE'
                  ]
                ]
              ),


            'Unit Type':
              unitType || null,


            'Sq Ft Per Unit':
              iwaNumber_(
                row[
                  H[
                    'SQ FT PER UNIT'
                  ]
                ]
              ),


            'Available Sq Ft':
              iwaNumber_(
                row[
                  H[
                    'AVAILABLE SQ FT'
                  ]
                ]
              ),


            'Details':
              iwaNullableText_(
                row[
                  H['DESCRIPTION']
                ]
              ),


            'Highlights':
              iwaNullableText_(
                row[
                  H['HIGHLIGHTS']
                ]
              ),


            'Card Spec 1':
              iwaNullableText_(
                row[
                  H['CARD SPEC 1']
                ]
              ),


            'Card Spec 2':
              iwaNullableText_(
                row[
                  H['CARD SPEC 2']
                ]
              ),


            'Card Spec 3':
              iwaNullableText_(
                row[
                  H['CARD SPEC 3']
                ]
              ),


            'Product URL':
              iwaNullableText_(
                row[
                  H['PRODUCT URL']
                ]
              ),


            'Reference Image URL':
              iwaNullableText_(
                row[
                  H[
                    'STOCK IMAGE URL'
                  ]
                ]
              ),


            'Post to Website':
              true,


            'Status':
              status,


            'Date Added':
              dateAdded,


            'Subcategory':
              iwaNullableText_(
                row[
                  H['SUBCATEGORY']
                ]
              ),


            'Thickness MM':
              iwaNumber_(
                row[
                  H['THICKNESS MM']
                ]
              ),


            'Wear Layer MIL':
              iwaNumber_(
                row[
                  H[
                    'WEAR LAYER MIL'
                  ]
                ]
              ),


            'Underlayment Attached':
              underResult.value,


            'Water Resistance':
              waterResult.value
          };


          /*
           * Successfully validated eligible product.
           */
          eligibleKeys.add(key);


          /*
           * New Airtable record.
           */
          if (!existingRecord) {
            recordsToWrite.push({
              fields: desiredFields
            });

            createdCount++;

            return;
          }


          /*
           * Existing Airtable record.
           *
           * Compare Website Export-owned fields locally.
           *
           * If nothing changed, DO NOT call Airtable PATCH.
           */
          if (
            iwaOwnedFieldsChanged_(
              desiredFields,
              existingFields
            )
          ) {
            recordsToWrite.push({
              fields: desiredFields
            });

            updatedCount++;
          } else {
            unchangedCount++;
          }


        } catch (error) {
          /*
           * This product is eligible in principle,
           * but currently contains invalid sync data.
           *
           * Protect its existing Airtable record from
           * stale/unpublish processing.
           */
          rejectedKeys.add(key);


          const message =
            error &&
            error.message
              ? error.message
              : String(error);


          if (
            message.indexOf(
              'Category'
            ) !== -1
          ) {
            invalid.category++;
          }


          if (
            message.indexOf(
              'Water Resistance'
            ) !== -1
          ) {
            invalid
              .waterResistance++;
          }


          if (
            message.indexOf(
              'Underlayment Attached'
            ) !== -1
          ) {
            invalid
              .underlaymentAttached++;
          }


          rejectedRows.push({
            row: sheetRow,
            productKey: key,
            error: message
          });


          console.warn(
            'Website Export row ' +
            sheetRow +
            ' rejected. Product Key: ' +
            key +
            ' | ' +
            message
          );
        }
      }
    );


  /*
   * Write only NEW or CHANGED products.
   */
  for (
    let i = 0;
    i < recordsToWrite.length;
    i +=
      IWA_SYNC_HARDENED.BATCH_SIZE
  ) {
    iwaRequest_(
      token,
      'patch',
      '',
      {
        records:
          recordsToWrite.slice(
            i,
            i +
              IWA_SYNC_HARDENED
                .BATCH_SIZE
          ),

        performUpsert: {
          fieldsToMergeOn: [
            'Product Key'
          ]
        },

        typecast: true
      }
    );


    Utilities.sleep(250);
  }


  /*
   * Find previously published Airtable records
   * that are no longer eligible.
   *
   * IMPORTANT:
   *
   * Rejected Website Export rows are excluded.
   *
   * A temporary bad enum/value must never cause
   * an otherwise valid published Airtable record
   * to disappear from the website.
   */
  const stale =
    existingRecords.filter(
      function(record) {
        const fields =
          record.fields || {};


        const key =
          iwaText_(
            fields['Product Key']
          );


        if (!key) {
          return false;
        }


        /*
         * Controlled run affects only requested keys.
         */
        if (
          requestedKeys &&
          !requestedKeys.has(key)
        ) {
          return false;
        }


        /*
         * Invalid temporary source data is not
         * treated as intentional unpublishing.
         */
        if (
          rejectedKeys.has(key)
        ) {
          return false;
        }


        return (
          fields[
            'Post to Website'
          ] === true &&
          !eligibleKeys.has(key)
        );
      }
    );


  /*
   * Unpublish stale Airtable records.
   *
   * Never delete them.
   */
  for (
    let i = 0;
    i < stale.length;
    i +=
      IWA_SYNC_HARDENED.BATCH_SIZE
  ) {
    iwaRequest_(
      token,
      'patch',
      '',
      {
        records:
          stale
            .slice(
              i,
              i +
                IWA_SYNC_HARDENED
                  .BATCH_SIZE
            )
            .map(
              function(record) {
                return {
                  id: record.id,

                  fields: {
                    'Post to Website':
                      false
                  }
                };
              }
            ),

        typecast: true
      }
    );


    Utilities.sleep(250);
  }


  /*
   * Number of Airtable PATCH requests actually made.
   *
   * This measures HTTP write requests,
   * not number of records written.
   */
  const airtableWriteRequests =
    (
      recordsToWrite.length > 0
        ? Math.ceil(
            recordsToWrite.length /
            IWA_SYNC_HARDENED
              .BATCH_SIZE
          )
        : 0
    ) +
    (
      stale.length > 0
        ? Math.ceil(
            stale.length /
            IWA_SYNC_HARDENED
              .BATCH_SIZE
          )
        : 0
    );


  const summary = {
    /*
     * Number of actual product records
     * upserted to Airtable.
     */
    synced:
      recordsToWrite.length,


    created:
      createdCount,


    updated:
      updatedCount,


    unchanged:
      unchangedCount,


    unpublished:
      stale.length,


    approvedRows:
      eligibleKeys.size,


    rejected:
      rejectedRows.length,


    controlled:
      !!requestedKeys,


    invalidCategory:
      invalid.category,


    invalidWaterResistance:
      invalid.waterResistance,


    invalidUnderlaymentAttached:
      invalid.underlaymentAttached,


    /*
     * Number of Airtable PATCH HTTP requests.
     */
    airtableWriteRequests:
      airtableWriteRequests,


    /*
     * Total API calls including:
     * - GET page(s)
     * - PATCH request(s)
     * - retry attempts
     */
    airtableApiCalls:
      iwaRequest_.callCount_ || 0,


    rejectedRows:
      rejectedRows
  };


  console.log(
    JSON.stringify(summary)
  );


  return summary;
}


/**
 * Compare fields owned by this synchronization.
 *
 * Airtable frequently omits blank fields instead
 * of returning them as explicit nulls.
 *
 * Normalize both sides before comparing.
 */
function iwaOwnedFieldsChanged_(
  desiredFields,
  existingFields
) {
  const fieldNames =
    Object.keys(desiredFields);


  for (
    let i = 0;
    i < fieldNames.length;
    i++
  ) {
    const fieldName =
      fieldNames[i];


    const desired =
      iwaComparable_(
        desiredFields[fieldName]
      );


    const existing =
      iwaComparable_(
        existingFields[fieldName]
      );


    if (desired !== existing) {
      return true;
    }
  }


  return false;
}


/**
 * Normalize values before equality comparison.
 */
function iwaComparable_(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '';
  }


  if (
    typeof value === 'boolean'
  ) {
    return value
      ? 'true'
      : 'false';
  }


  if (
    typeof value === 'number'
  ) {
    /*
     * Avoid harmless numeric representation
     * differences such as 37.50 vs 37.5.
     */
    return String(value);
  }


  return String(value).trim();
}


/**
 * Read all Airtable Website Products.
 */
function iwaFetchAll_(token) {
  const all = [];

  let offset = '';


  do {
    const suffix =
      offset
        ? '?pageSize=100&offset=' +
          encodeURIComponent(offset)
        : '?pageSize=100';


    const result =
      iwaRequest_(
        token,
        'get',
        suffix
      );


    if (
      result &&
      Array.isArray(
        result.records
      )
    ) {
      result.records.forEach(
        function(record) {
          all.push(record);
        }
      );
    }


    offset =
      result &&
      result.offset
        ? result.offset
        : '';


    if (offset) {
      Utilities.sleep(250);
    }


  } while (offset);


  return all;
}


/**
 * Airtable HTTP request wrapper.
 *
 * Retries:
 * - HTTP 429
 * - HTTP 5xx
 *
 * Honors Retry-After when supplied.
 */
function iwaRequest_(
  token,
  method,
  suffix,
  payload
) {
  const url =
    'https://api.airtable.com/v0/' +
    encodeURIComponent(
      IWA_SYNC_HARDENED.BASE_ID
    ) +
    '/' +
    encodeURIComponent(
      IWA_SYNC_HARDENED.TABLE_NAME
    ) +
    (suffix || '');


  const options = {
    method: method,

    muteHttpExceptions:
      true,

    headers: {
      Authorization:
        'Bearer ' + token
    }
  };


  if (payload !== undefined) {
    options.contentType =
      'application/json';


    options.payload =
      JSON.stringify(payload);
  }


  let lastCode = 0;
  let lastBody = '';


  for (
    let attempt = 1;
    attempt <=
      IWA_SYNC_HARDENED.MAX_ATTEMPTS;
    attempt++
  ) {
    const now =
      Date.now();


    const elapsed =
      now -
      (
        iwaRequest_
          .lastRequestAt_ ||
        0
      );


    if (
      elapsed <
      IWA_SYNC_HARDENED
        .MIN_REQUEST_INTERVAL_MS
    ) {
      Utilities.sleep(
        IWA_SYNC_HARDENED
          .MIN_REQUEST_INTERVAL_MS -
        elapsed
      );
    }


    iwaRequest_.lastRequestAt_ =
      Date.now();


    /*
     * Every fetch attempt counts as one Airtable API call.
     */
    iwaRequest_.callCount_ =
      (
        iwaRequest_.callCount_ ||
        0
      ) + 1;


    const response =
      UrlFetchApp.fetch(
        url,
        options
      );


    const code =
      response
        .getResponseCode();


    const body =
      response
        .getContentText();


    lastCode = code;
    lastBody = body;


    if (
      code >= 200 &&
      code < 300
    ) {
      return body
        ? JSON.parse(body)
        : {};
    }


    /*
     * Non-retryable 4xx error.
     */
    if (
      code !== 429 &&
      code < 500
    ) {
      throw new Error(
        'Airtable request failed. HTTP ' +
        code +
        ': ' +
        body
      );
    }


    /*
     * Retry rate limits and server errors.
     */
    if (
      attempt <
      IWA_SYNC_HARDENED
        .MAX_ATTEMPTS
    ) {
      Utilities.sleep(
        iwaRetryDelay_(
          response,
          attempt
        )
      );
    }
  }


  throw new Error(
    'Airtable request failed after ' +
    IWA_SYNC_HARDENED.MAX_ATTEMPTS +
    ' attempts. Last HTTP ' +
    lastCode +
    ': ' +
    lastBody
  );
}


/**
 * Airtable retry delay.
 *
 * Uses Retry-After when available,
 * otherwise exponential backoff.
 */
function iwaRetryDelay_(
  response,
  attempt
) {
  const headers =
    response.getAllHeaders();


  const retryAfter =
    headers['Retry-After'] ||
    headers['retry-after'];


  const seconds =
    Number(
      Array.isArray(retryAfter)
        ? retryAfter[0]
        : retryAfter
    );


  return (
    Number.isFinite(seconds) &&
    seconds > 0
  )
    ? Math.min(
        seconds * 1000,
        30000
      )
    : Math.min(
        1000 *
          Math.pow(
            2,
            attempt - 1
          ),
        30000
      );
}


/**
 * Validate Airtable single-select values.
 */
function iwaEnum_(
  value,
  allowed,
  fieldName
) {
  const text =
    iwaText_(value);


  if (!text) {
    return {
      value: null,
      invalid: false
    };
  }


  const match =
    allowed.filter(
      function(item) {
        return (
          item.toLowerCase() ===
          text.toLowerCase()
        );
      }
    )[0];


  if (match) {
    return {
      value: match,
      invalid: false
    };
  }


  throw new Error(
    'Invalid Airtable enum for ' +
    fieldName +
    ': ' +
    text
  );
}


/**
 * Normalize Website Export Water Resistance.
 *
 * Supports historical sheet values:
 *
 * Yes -> Waterproof
 * No  -> Not Water Resistant
 *
 * Also accepts canonical Airtable values:
 * - Waterproof
 * - Water Resistant
 * - Not Water Resistant
 * - Unknown
 */
function iwaWaterResistance_(value) {
  const text =
    iwaText_(value);


  if (!text) {
    return {
      value: null,
      invalid: false
    };
  }


  const lower =
    text.toLowerCase();


  if (lower === 'yes') {
    return {
      value: 'Waterproof',
      invalid: false
    };
  }


  if (lower === 'no') {
    return {
      value:
        'Not Water Resistant',
      invalid: false
    };
  }


  return iwaEnum_(
    text,
    IWA_H_WATER_RESISTANCE_VALUES,
    'Water Resistance'
  );
}


/**
 * Convert value to trimmed text.
 */
function iwaText_(value) {
  return String(
    value === null ||
    value === undefined
      ? ''
      : value
  ).trim();
}


/**
 * Blank text -> null.
 */
function iwaNullableText_(value) {
  const text =
    iwaText_(value);


  return text || null;
}


/**
 * Convert Sheet value to number.
 *
 * Blank/non-numeric values become null.
 */
function iwaNumber_(value) {
  if (
    value === '' ||
    value === null ||
    value === undefined
  ) {
    return null;
  }


  const number =
    Number(value);


  return Number.isFinite(number)
    ? number
    : null;
}


/**
 * Normalize Yes / TRUE / 1 style boolean values.
 */
function iwaBool_(value) {
  if (value === true) {
    return true;
  }


  const text =
    iwaText_(value)
      .toLowerCase();


  return (
    text === 'yes' ||
    text === 'true' ||
    text === '1'
  );
}