/**
 * Invicta Home Supply
 * Website Export → Airtable Sync v2
 *
 * HEADER-BASED.
 *
 * Product Key is the stable upsert identity.
 *
 * IMPORTANT:
 * - Does NOT overwrite Photos
 * - Does NOT overwrite Was Price
 * - Does NOT overwrite Status
 * - Does NOT overwrite Date Added
 * - Does NOT overwrite Date Reserved
 * - Missing Airtable records are created
 * - Existing records update by Product Key
 * - Stale Airtable records are unpublished,
 *   NOT deleted
 *
 * Required Script Property:
 * AIRTABLE_TOKEN
 */

const IWA_SYNC = {
  BASE_ID:
    'apptugvm4r5tm2OIt',

  TABLE_NAME:
    'Website Products',

  EXPORT_SHEET:
    'Website Export',

  TOKEN_PROPERTY:
    'AIRTABLE_TOKEN'
};

function syncWebsiteExportToAirtableV2() {
  const token =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        IWA_SYNC.TOKEN_PROPERTY
      );

  if (!token) {
    throw new Error(
      'Missing Script Property AIRTABLE_TOKEN.'
    );
  }

  const ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  const sheet =
    ss.getSheetByName(
      IWA_SYNC.EXPORT_SHEET
    );

  if (!sheet) {
    throw new Error(
      'Missing Website Export sheet.'
    );
  }

  const lastRow =
    sheet.getLastRow();

  const lastCol =
    sheet.getLastColumn();

  if (lastRow < 2) {
    return {
      synced: 0,
      unpublished: 0
    };
  }

  const values =
    sheet
      .getRange(
        1,
        1,
        lastRow,
        lastCol
      )
      .getValues();

  const headers =
    values[0].map(
      function(v) {
        return String(v || '')
          .trim();
      }
    );

  const H = {};

  headers.forEach(
    function(h, i) {
      if (h) {
        H[h] = i;
      }
    }
  );

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
    'WATER RESISTANCE'
  ];

  const missing =
    required.filter(
      function(h) {
        return H[h] === undefined;
      }
    );

  if (missing.length) {
    throw new Error(
      'Website Export missing headers: ' +
      missing.join(', ')
    );
  }

  const exportKeys =
    new Set();

  const records = [];

  values
    .slice(1)
    .forEach(function(row) {
      const key =
        iwaText_(
          row[
            H['PRODUCT KEY']
          ]
        );

      if (!key) {
        return;
      }

      exportKeys.add(key);

      const category =
        iwaText_(
          row[
            H['CATEGORY']
          ]
        );

      const unitType =
        iwaText_(
          row[
            H['UNIT TYPE']
          ]
        );

      const post =
        iwaBool_(
          row[
            H['POST TO WEBSITE']
          ]
        );

      const inStock =
        iwaBool_(
          row[
            H['IN STOCK']
          ]
        );

      const fields = {
        'Product Key':
          key,

        'Name':
          iwaText_(
            row[
              H['DISPLAY NAME']
            ]
          ) || key,

        'Category':
          iwaNullableText_(
            row[
              H['CATEGORY']
            ]
          ),

        'Brand':
          iwaNullableText_(
            row[
              H['BRAND']
            ]
          ),

        'Model':
          iwaNullableText_(
            row[
              H['MODEL']
            ]
          ),

        'Retail SKU':
          iwaNullableText_(
            row[
              H['RETAIL SKU']
            ]
          ),

        'Retailer':
          iwaNullableText_(
            row[
              H['RETAILER']
            ]
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
            : (
                unitType === 'Box'
                  ? 'Per Box'
                  : 'Each'
              ),

        'Box Price':
          iwaNumber_(
            row[
              H['BOX PRICE']
            ]
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
              H['SQ FT PER UNIT']
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

        /*
         * Only publish when:
         * POST TO WEBSITE = Yes
         * AND
         * IN STOCK = Yes
         */
        'Post to Website':
          post && inStock,

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
              H['WEAR LAYER MIL']
            ]
          ),

        'Underlayment Attached':
          iwaNullableText_(
            row[
              H[
                'UNDERLAYMENT ATTACHED'
              ]
            ]
          ),

        'Water Resistance':
          iwaNullableText_(
            row[
              H[
                'WATER RESISTANCE'
              ]
            ]
          )
      };

      records.push({
        fields: fields
      });
    });

  /*
   * Airtable accepts max 10 records
   * per request.
   */
  for (
    let i = 0;
    i < records.length;
    i += 10
  ) {
    iwaRequest_(
      token,
      'patch',
      '',
      {
        records:
          records.slice(
            i,
            i + 10
          ),

        performUpsert: {
          fieldsToMergeOn: [
            'Product Key'
          ]
        },

        typecast: true
      }
    );
  }

  /*
   * Fetch Airtable after upsert.
   * Anything no longer present in
   * Website Export is unpublished,
   * not deleted.
   */
  const existing =
    iwaFetchAll_(token);

  const stale =
    existing.filter(
      function(rec) {
        const key =
          iwaText_(
            (rec.fields || {})[
              'Product Key'
            ]
          );

        return (
          key &&
          !exportKeys.has(key) &&
          rec.fields[
            'Post to Website'
          ] === true
        );
      }
    );

  for (
    let i = 0;
    i < stale.length;
    i += 10
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
              i + 10
            )
            .map(
              function(rec) {
                return {
                  id: rec.id,

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
  }

  const summary = {
    synced:
      records.length,

    unpublished:
      stale.length
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
    const suffix =
      offset
        ? (
            '?pageSize=100&offset=' +
            encodeURIComponent(
              offset
            )
          )
        : '?pageSize=100';

    const result =
      iwaRequest_(
        token,
        'get',
        suffix
      );

    (
      result.records || []
    ).forEach(
      function(r) {
        all.push(r);
      }
    );

    offset =
      result.offset || '';

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
      IWA_SYNC.BASE_ID
    ) +
    '/' +
    encodeURIComponent(
      IWA_SYNC.TABLE_NAME
    ) +
    (suffix || '');

  const options = {
    method: method,

    headers: {
      Authorization:
        'Bearer ' + token
    },

    muteHttpExceptions:
      true
  };

  if (
    payload !== undefined
  ) {
    options.contentType =
      'application/json';

    options.payload =
      JSON.stringify(
        payload
      );
  }

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

  if (
    code < 200 ||
    code >= 300
  ) {
    throw new Error(
      'Airtable HTTP ' +
      code +
      ': ' +
      body
    );
  }

  return body
    ? JSON.parse(body)
    : {};
}

function iwaText_(v) {
  return String(
    v === null ||
    v === undefined
      ? ''
      : v
  ).trim();
}

function iwaNullableText_(v) {
  const x =
    iwaText_(v);

  return x || null;
}

function iwaNumber_(v) {
  if (
    v === '' ||
    v === null ||
    v === undefined
  ) {
    return null;
  }

  const n =
    Number(v);

  return Number.isFinite(n)
    ? n
    : null;
}

function iwaBool_(v) {
  if (v === true) {
    return true;
  }

  const s =
    iwaText_(v)
      .toLowerCase();

  return (
    s === 'yes' ||
    s === 'true' ||
    s === '1'
  );
}
