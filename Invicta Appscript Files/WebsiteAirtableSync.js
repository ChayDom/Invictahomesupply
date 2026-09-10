/**
 * Invicta Home Supply - Website Export to Airtable sync.
 * Publishes only POST TO WEBSITE = Yes and IN STOCK = TRUE rows.
 * Existing Airtable records that become ineligible are unpublished, not deleted.
 */
const IWA_SYNC_HARDENED = {
  BASE_ID: 'apptugvm4r5tm2OIt',
  TABLE_NAME: 'Website Products',
  EXPORT_SHEET: 'Website Export',
  TOKEN_PROPERTY: 'AIRTABLE_TOKEN',
  BATCH_SIZE: 10,
  MIN_REQUEST_INTERVAL_MS: 220,
  MAX_ATTEMPTS: 5
};

const IWA_H_CATEGORY_VALUES = WEBSITE_CATEGORY_VALUES;

/*
 * Canonical Airtable values. Historical Yes/No values are normalized by
 * iwaWaterResistance_() for backward compatibility.
 */
const IWA_H_WATER_RESISTANCE_VALUES = [
  'Waterproof',
  'Water Resistant',
  'Not Water Resistant',
  'Unknown'
];

const IWA_H_UNDERLAYMENT_VALUES = ['Yes', 'No'];

function syncWebsiteExportToAirtable(options) {
  const opts = options || {};

  const requestedKeys = opts.productKeys
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

  const sheet = spreadsheet.getSheetByName(
    IWA_SYNC_HARDENED.EXPORT_SHEET
  );

  if (!sheet) {
    throw new Error(
      'Required sheet missing: "' +
        IWA_SYNC_HARDENED.EXPORT_SHEET +
        '".'
    );
  }

  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    console.log('Website Export has no data rows.');
    return {
      synced: 0,
      unpublished: 0,
      approvedRows: 0,
      controlled: !!requestedKeys
    };
  }

  const headers = values[0].map(function(value) {
    return iwaText_(value).toUpperCase();
  });

  const H = {};

  headers.forEach(function(header, index) {
    if (header) {
      H[header] = index;
    }
  });

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

  const missing = required.filter(function(header) {
    return H[header] === undefined;
  });

  if (missing.length > 0) {
    throw new Error(
      'Website Export is missing required column(s): ' +
        missing.join(', ')
    );
  }

  const token =
    PropertiesService.getScriptProperties()
      .getProperty(
        IWA_SYNC_HARDENED.TOKEN_PROPERTY
      );

  if (!token) {
    throw new Error(
      'Missing Script Property: ' +
        IWA_SYNC_HARDENED.TOKEN_PROPERTY
    );
  }
/*
 * Preserve Date Added across future syncs.
 * Existing blank dates use the Airtable record creation date.
 * Genuinely new records use today's Central Time date.
 */
const existingRecords = iwaFetchAll_(token);
const existingByKey = new Map();

existingRecords.forEach(function(record) {
  const fields = record.fields || {};
  const key = iwaText_(fields['Product Key']);

  if (key) {
    existingByKey.set(key, record);
  }
});

const today = Utilities.formatDate(
  new Date(),
  'America/Chicago',
  'yyyy-MM-dd'
);

  const records = [];
  const eligibleKeys = new Set();
  const rejectedKeys = new Set();
  const rejectedRows = [];

  const invalid = {
    category: 0,
    waterResistance: 0,
    underlaymentAttached: 0
  };

  values.slice(1).forEach(function(row) {
    const key = iwaText_(
      row[H['PRODUCT KEY']]
    );

    if (!key) {
      return;
    }

    const post = iwaBool_(
      row[H['POST TO WEBSITE']]
    );

    const inStock = iwaBool_(
      row[H['IN STOCK']]
    );

    if (!post || !inStock) {
      return;
    }

    if (
      requestedKeys &&
      !requestedKeys.has(key)
    ) {
      return;
    }

    let categoryResult;
    let waterResult;
    let underResult;

    try {
      categoryResult = iwaEnum_(
        row[H['CATEGORY']],
        IWA_H_CATEGORY_VALUES,
        'Category'
      );

      waterResult = iwaWaterResistance_(
        row[H['WATER RESISTANCE']]
      );

      underResult = iwaEnum_(
        row[H['UNDERLAYMENT ATTACHED']],
        IWA_H_UNDERLAYMENT_VALUES,
        'Underlayment Attached'
      );
    } catch (error) {
      const reason = String(error.message || error);
      rejectedKeys.add(key);
      rejectedRows.push({
        productKey: key,
        reason: reason
      });
      console.error(
        'Website Export row rejected for ' + key + ': ' + reason
      );
      return;
    }

    eligibleKeys.add(key);

    const category = categoryResult.value;
    const unitType = iwaText_(
      row[H['UNIT TYPE']]
    );
    const existingRecord = existingByKey.get(key);

const existingFields = existingRecord
  ? existingRecord.fields || {}
  : {};

const dateAdded =
  iwaNullableText_(existingFields['Date Added']) ||
  (existingRecord && existingRecord.createdTime
    ? Utilities.formatDate(
        new Date(existingRecord.createdTime),
        'America/Chicago',
        'yyyy-MM-dd'
      )
    : today);
    

    records.push({
      fields: {
        'Product Key': key,

        'Name':
          iwaText_(
            row[H['DISPLAY NAME']]
          ) || key,

        'Category': category,

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
            row[H['RETAIL SKU']]
          ),

        'Retailer':
          iwaNullableText_(
            row[H['RETAILER']]
          ),

        'Price':
          iwaNumber_(
            row[H['WEBSITE PRICE']]
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
            row[H['QUANTITY AVAILABLE']]
          ),

        'Unit Type':
          unitType || null,

        'Sq Ft Per Unit':
          iwaNumber_(
            row[H['SQ FT PER UNIT']]
          ),

        'Available Sq Ft':
          iwaNumber_(
            row[H['AVAILABLE SQ FT']]
          ),

        'Details':
          iwaNullableText_(
            row[H['DESCRIPTION']]
          ),

        'Highlights':
          iwaNullableText_(
            row[H['HIGHLIGHTS']]
          ),

        'Card Spec 1':
          iwaNullableText_(
            row[H['CARD SPEC 1']]
          ),

        'Card Spec 2':
          iwaNullableText_(
            row[H['CARD SPEC 2']]
          ),

        'Card Spec 3':
          iwaNullableText_(
            row[H['CARD SPEC 3']]
          ),

        'Product URL':
          iwaNullableText_(
            row[H['PRODUCT URL']]
          ),

        'Reference Image URL':
          iwaNullableText_(
            row[H['STOCK IMAGE URL']]
          ),

        'Post to Website': true,

        'Status':
          iwaNullableText_(existingFields['Status']) ||
          'In Stock',
        
        'Date Added': dateAdded,

        'Subcategory':
          iwaNullableText_(
            row[H['SUBCATEGORY']]
          ),

        'Thickness MM':
          iwaNumber_(
            row[H['THICKNESS MM']]
          ),

        'Wear Layer MIL':
          iwaNumber_(
            row[H['WEAR LAYER MIL']]
          ),

        'Underlayment Attached':
          underResult.value,

        'Water Resistance':
          waterResult.value
      }
    });
  });

  for (
    let i = 0;
    i < records.length;
    i += IWA_SYNC_HARDENED.BATCH_SIZE
  ) {
    iwaRequest_(
      token,
      'patch',
      '',
      {
        records: records.slice(
          i,
          i + IWA_SYNC_HARDENED.BATCH_SIZE
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

   const stale = existingRecords.filter(
    function(record) {
      const fields = record.fields || {};

      const key = iwaText_(
        fields['Product Key']
      );

      if (!key) {
        return false;
      }

      if (
        requestedKeys &&
        !requestedKeys.has(key)
      ) {
        return false;
      }

      return (
        fields['Post to Website'] === true &&
        !eligibleKeys.has(key) &&
        !rejectedKeys.has(key)
      );
    }
  );

  for (
    let i = 0;
    i < stale.length;
    i += IWA_SYNC_HARDENED.BATCH_SIZE
  ) {
    iwaRequest_(
      token,
      'patch',
      '',
      {
        records: stale
          .slice(
            i,
            i +
              IWA_SYNC_HARDENED.BATCH_SIZE
          )
          .map(function(record) {
            return {
              id: record.id,
              fields: {
                'Post to Website': false
              }
            };
          }),
        typecast: true
      }
    );

    Utilities.sleep(250);
  }

  const summary = {
    synced: records.length,
    unpublished: stale.length,
    approvedRows: eligibleKeys.size,
    controlled: !!requestedKeys,
    invalidCategory: invalid.category,
    invalidWaterResistance:
      invalid.waterResistance,
    invalidUnderlaymentAttached:
      invalid.underlaymentAttached,
    rejected: rejectedRows.length,
    rejectedRows: rejectedRows
  };

  console.log(
    JSON.stringify(summary)
  );

  return summary;
}

function iwaFetchAll_(token) {
  const all = [];
  let offset = '';

  do {
    const suffix = offset
      ? '?pageSize=100&offset=' +
        encodeURIComponent(offset)
      : '?pageSize=100';

    const result = iwaRequest_(
      token,
      'get',
      suffix
    );

    if (
      result &&
      Array.isArray(result.records)
    ) {
      result.records.forEach(
        function(record) {
          all.push(record);
        }
      );
    }

    offset =
      result && result.offset
        ? result.offset
        : '';

    if (offset) {
      Utilities.sleep(250);
    }
  } while (offset);

  return all;
}

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
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + token
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
    const now = Date.now();

    const elapsed =
      now -
      (
        iwaRequest_.lastRequestAt_ ||
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

    const response =
      UrlFetchApp.fetch(
        url,
        options
      );

    const code =
      response.getResponseCode();

    const body =
      response.getContentText();

    lastCode = code;
    lastBody = body;

    if (code >= 200 && code < 300) {
      return body
        ? JSON.parse(body)
        : {};
    }

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

    if (
      attempt <
      IWA_SYNC_HARDENED.MAX_ATTEMPTS
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

function iwaRetryDelay_(
  response,
  attempt
) {
  const headers =
    response.getAllHeaders();

  const retryAfter =
    headers['Retry-After'] ||
    headers['retry-after'];

  const seconds = Number(
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

function iwaWaterResistance_(value) {
  const text = iwaText_(value);

  if (!text) {
    return { value: null, invalid: false };
  }

  const normalized = text.toLowerCase();

  if (normalized === 'yes') {
    return { value: 'Waterproof', invalid: false };
  }

  if (normalized === 'no') {
    return { value: 'Not Water Resistant', invalid: false };
  }

  return iwaEnum_(
    text,
    IWA_H_WATER_RESISTANCE_VALUES,
    'Water Resistance'
  );
}

function iwaEnum_(
  value,
  allowed,
  fieldName
) {
  const text = iwaText_(value);

  if (!text) {
    return {
      value: null,
      invalid: false
    };
  }

  const match = allowed.filter(
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

function iwaText_(value) {
  return String(
    value === null ||
    value === undefined
      ? ''
      : value
  ).trim();
}

function iwaNullableText_(value) {
  const text = iwaText_(value);
  return text || null;
}

function iwaNumber_(value) {
  if (
    value === '' ||
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function iwaBool_(value) {
  if (value === true) {
    return true;
  }

  const text =
    iwaText_(value).toLowerCase();

  return (
    text === 'yes' ||
    text === 'true' ||
    text === '1'
  );
}