/**
 * Product catalog enrichment through the Gemini Developer API.
 * Existing content is never overwritten; legacy records are excluded.
 * A stock image URL is written only for an exact, cited result.
 *
 * Card Specs:
 * - Generated for future eligible products.
 * - Existing Card Specs are never overwritten.
 * * - Maximum three specs.
 * - Maximum 24 characters per spec.
 */

const ENRICHMENT_CARD_SPEC_COLUMNS_ = Object.freeze({
  CARD_SPEC_1: 33, // AG
  CARD_SPEC_2: 34, // AH
  CARD_SPEC_3: 35  // AI
});

function runCatalogEnrichmentTest() {
  return processCatalogEnrichment_(5);
}

function runCatalogEnrichment() {
  return processCatalogEnrichment_(
    ENRICHMENT_CONFIG.BATCH_SIZE
  );
}

function processCatalogEnrichment_(limit) {
  const apiKey = PropertiesService
    .getScriptProperties()
    .getProperty(
      ENRICHMENT_CONFIG.API_KEY_PROPERTY
    );

  if (!apiKey) {
    throw new Error(
      'Missing Script Property ' +
        ENRICHMENT_CONFIG.API_KEY_PROPERTY +
        '. Add the Gemini API key in Project Settings ' +
        '> Script Properties.'
    );
  }

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another catalog enrichment run is already active.'
    );
  }

  const summary = {
    processed: 0,
    enriched: 0,
    needsReview: 0,
    failed: 0
  };

  try {
    const spreadsheet =
      SpreadsheetApp.getActiveSpreadsheet();

    const sheet = getInventorySheetOrThrow_(
      spreadsheet,
      INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET
    );

    const lastRow = getLastDataRowInColumn_(
      sheet,
      CATALOG_COLUMNS.PRODUCT_KEY
    );

    if (lastRow < 2) {
      return summary;
    }

    /*
     * Card Spec 3 in column AI is now farther right than
     * LAST_ENRICHED_AT. Read through whichever column is
     * farthest to ensure existing Card Specs are preserved.
     */
    const lastRequiredColumn = Math.max(
      CATALOG_COLUMNS.LAST_ENRICHED_AT,
      ENRICHMENT_CARD_SPEC_COLUMNS_.CARD_SPEC_3
    );

    const rows = sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        lastRequiredColumn
      )
      .getValues();

    for (
      let index = 0;
      index < rows.length &&
      summary.processed < limit;
      index++
    ) {
      const values = rows[index];

      if (
        !isCatalogRowEligibleForEnrichment_(
          values
        )
      ) {
        continue;
      }

      const rowNumber = index + 2;
      summary.processed++;

      sheet
        .getRange(
          rowNumber,
          CATALOG_COLUMNS.ENRICHMENT_STATUS
        )
        .setValue('PROCESSING');

      SpreadsheetApp.flush();

      try {
        const record =
          catalogRowToEnrichmentRecord_(
            values,
            rowNumber
          );

        const result =
          callGeminiProductEnrichment_(
            record,
            apiKey
          );

        const finalStatus =
          applyCatalogEnrichmentResult_(
            sheet,
            rowNumber,
            values,
            result
          );

        if (
          finalStatus ===
          'ENRICHED - VERIFIED'
        ) {
          summary.enriched++;
        } else {
          summary.needsReview++;
        }
      } catch (error) {
        sheet
          .getRange(
            rowNumber,
            CATALOG_COLUMNS.ENRICHMENT_STATUS
          )
          .setValue('FAILED');

        appendCatalogNote_(
          sheet,
          rowNumber,
          'Gemini enrichment failed: ' +
            String(
              error.message || error
            )
        );

        summary.failed++;
      }
    }

    console.log(
      JSON.stringify(summary)
    );

    return summary;
  } finally {
    lock.releaseLock();
  }
}

function isCatalogRowEligibleForEnrichment_(
  values
) {
  const key = String(
    values[
      CATALOG_COLUMNS.PRODUCT_KEY - 1
    ] || ''
  )
    .trim()
    .toUpperCase();

  const sourceItem = String(
    values[
      CATALOG_COLUMNS.SOURCE_ITEM - 1
    ] || ''
  ).trim();

  const description = String(
    values[
      CATALOG_COLUMNS.DESCRIPTION - 1
    ] || ''
  ).trim();

  const highlights = String(
    values[
      CATALOG_COLUMNS.HIGHLIGHTS - 1
    ] || ''
  ).trim();

  const status = String(
    values[
      CATALOG_COLUMNS.ENRICHMENT_STATUS - 1
    ] || ''
  )
    .trim()
    .toUpperCase();

  const locked =
    values[
      CATALOG_COLUMNS.CONTENT_LOCKED - 1
    ] === true;

  const lastEnriched =
    values[
      CATALOG_COLUMNS.LAST_ENRICHED_AT - 1
    ];

  /*
   * Existing legacy catalog records are never
   * researched automatically.
   */
  if (key.indexOf('LEG-') === 0) {
    return false;
  }

  /*
   * The normal enrichment queue remains unchanged.
   * This prevents the new Card Spec feature from
   * reprocessing all existing enriched products.
   */
  if (
    !key ||
    !sourceItem ||
    locked ||
    (description && highlights)
  ) {
    return false;
  }

  if (
    status === 'PROCESSING' ||
    status === 'FAILED' ||
    status === 'ENRICHED - VERIFIED'
  ) {
    return false;
  }

  /*
   * Do not repeatedly spend API calls on the same
   * uncertain record.
   */
  if (
    status === 'NEEDS REVIEW' &&
    lastEnriched
  ) {
    return false;
  }

  return true;
}

function catalogRowToEnrichmentRecord_(
  values,
  rowNumber
) {
  return {
    rowNumber: rowNumber,

    productKey: String(
      values[
        CATALOG_COLUMNS.PRODUCT_KEY - 1
      ] || ''
    ).trim(),

    retailer: String(
      values[
        CATALOG_COLUMNS.RETAILER - 1
      ] || ''
    ).trim(),

    retailSku: String(
      values[
        CATALOG_COLUMNS.RETAIL_SKU - 1
      ] || ''
    ).trim(),

    sourceItem: String(
      values[
        CATALOG_COLUMNS.SOURCE_ITEM - 1
      ] || ''
    ).trim(),

    sourceCategory: String(
      values[
        CATALOG_COLUMNS.SOURCE_CATEGORY - 1
      ] || ''
    ).trim(),

    existingDisplayName: String(
      values[
        CATALOG_COLUMNS.DISPLAY_NAME - 1
      ] || ''
    ).trim(),

    existingBrand: String(
      values[
        CATALOG_COLUMNS.BRAND - 1
      ] || ''
    ).trim(),

    existingModel: String(
      values[
        CATALOG_COLUMNS.MODEL - 1
      ] || ''
    ).trim(),

    existingUrl: String(
      values[
        CATALOG_COLUMNS.PRODUCT_URL - 1
      ] || ''
    ).trim(),

    existingCardSpec1: String(
      values[
        ENRICHMENT_CARD_SPEC_COLUMNS_
          .CARD_SPEC_1 - 1
      ] || ''
    ).trim(),

    existingCardSpec2: String(
      values[
        ENRICHMENT_CARD_SPEC_COLUMNS_
          .CARD_SPEC_2 - 1
      ] || ''
    ).trim(),

    existingCardSpec3: String(
      values[
        ENRICHMENT_CARD_SPEC_COLUMNS_
          .CARD_SPEC_3 - 1
      ] || ''
    ).trim()
  };
}

function callGeminiProductEnrichment_(
  record,
  apiKey
) {
  const endpoint =
    'https://generativelanguage.googleapis.com/' +
    'v1beta/interactions';

  const payload = {
    model: ENRICHMENT_CONFIG.MODEL,
    input:
      buildGeminiEnrichmentPrompt_(
        record
      ),
    tools: [
      {
        type: 'google_search'
      }
    ]
  };

  const response = UrlFetchApp.fetch(
    endpoint,
    {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-goog-api-key': apiKey
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
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
        body.slice(0, 500)
    );
  }

  const responseJson =
    JSON.parse(body);

  const responseText =
    extractGeminiText_(responseJson);

  if (!responseText) {
    throw new Error(
      'Gemini returned no model-output text.'
    );
  }

  const result =
    parseGeminiJson_(responseText);

  result.sourceUrls =
    extractCitationUrls_(responseJson);

  return result;
}

function buildGeminiEnrichmentPrompt_(
  record
) {
  return [
    'Find and verify the exact retail product described below.',
    'Use Google Search grounding.',
    'Prefer the official manufacturer page, then the named retailer.',
    'Use the retailer SKU/model and exact title to prevent similar-product matches.',
    'Do not invent specifications, dimensions, warranty, compatibility, benefits, URLs, or image links.',
    'Never copy the retailer SKU into the manufacturer model field unless the source explicitly identifies it as the model number.',
    'If the exact match cannot be established, use LIKELY or NOT_FOUND and LOW confidence.',
    'For website_category, choose exactly one approved broad category from: ' + WEBSITE_CATEGORY_VALUES.join(', ') + '.',
    'If no more specific approved broad category reasonably fits, use Other. Never invent a new top-level website category.',
    '',
    'Retailer: ' + record.retailer,
    'Retail SKU: ' + record.retailSku,
    'Inventory title: ' + record.sourceItem,
    'Source category: ' +
      record.sourceCategory,
    'Product key: ' + record.productKey,
    'Existing display name: ' +
      record.existingDisplayName,
    'Existing brand: ' +
      record.existingBrand,
    'Existing model: ' +
      record.existingModel,
    'Existing product URL: ' +
      record.existingUrl,
    'Existing Card Spec 1: ' +
      record.existingCardSpec1,
    'Existing Card Spec 2: ' +
      record.existingCardSpec2,
    'Existing Card Spec 3: ' +
      record.existingCardSpec3,
    '',
    'For stock_image_url: return a direct HTTPS image URL only when it is clearly the exact product image found in official retailer/manufacturer evidence.',
    'Do not return a product page URL, search-results URL, thumbnail, logo, or a constructed/guessed URL.',
    'If you cannot verify a direct product-image URL, return an empty string.',
    '',
    'Return only valid JSON with exactly these keys:',
    '{',
    '  "match_status": "EXACT|LIKELY|NOT_FOUND",',
    '  "display_name": "",',
    '  "website_category": "",',
    '  "brand": "",',
    '  "model": "",',
    '  "product_url": "",',
    '  "stock_image_url": "",',
    '  "description": "",',
    '  "highlights": ["four to six short factual highlights"],',
    '  "card_specs": ["", "", ""],',
    '  "confidence": "HIGH|MEDIUM|LOW",',
    '  "notes": ""',
    '}',
    '',
    'Display name must be a short customer-facing catalog name, not the full retailer listing title.',
    'Keep display_name concise: normally Brand + product/collection name + essential product type only.',
    'Do not include carton square footage, plank dimensions, installation wording, retailer name, SKU, or model in display_name unless essential to identify the product.',
    'Target 35-60 characters for display_name and never exceed 70 characters.',
    'Description should be two concise factual sentences suitable for a product catalog.',
    'Return 4 to 6 highlights. Each highlight must be a short scan-friendly spec or feature, not a sentence.',
    'Keep each highlight to about 2-6 words and no more than 45 characters.',
    'Good highlight examples: \"100% Waterproof\", \"20 MIL Wear Layer\", \"Attached Underlayment\", \"7 in. x 48 in. Planks\", \"24.03 Sq Ft/Carton\".',
    'Highlights must be factual, non-repetitive, and must not include price, marketing filler, or explanatory wording.',
    '',
    'For card_specs, return up to three of the most useful verified specifications for this exact product.',
    'Each Card Spec must be plain text, no more than 24 characters, and understandable without a complete sentence.',
    'Examples include "50 gal", "4500W", "9-year warranty", "65 in.", "4K UHD", "5 mm", and "12 MIL".',
    'Choose specifications that help a customer compare this type of product.',
    'Do not include price, inventory quantity, availability, promotional claims, labels, or unsupported facts.',
    'Do not repeat the brand, model, product name, retailer, or SKU as a Card Spec.',
    'Do not repeat the same specification in multiple Card Specs.',
    'Use an empty string when a Card Spec cannot be verified.'
  ].join('\n');
}

function extractGeminiText_(value) {
  const textParts = [];

  function walk(node) {
    if (!node) {
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (typeof node !== 'object') {
      return;
    }

    if (
      node.type === 'text' &&
      typeof node.text === 'string'
    ) {
      textParts.push(node.text);
    } else if (
      node.type === 'model_output' &&
      typeof node.output_text ===
        'string'
    ) {
      textParts.push(
        node.output_text
      );
    }

    Object.keys(node).forEach(
      function(key) {
        if (key !== 'annotations') {
          walk(node[key]);
        }
      }
    );
  }

  walk(value);

  return textParts
    .join('\n')
    .trim();
}

function extractCitationUrls_(value) {
  const urls = [];

  function walk(node) {
    if (!node) {
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (typeof node !== 'object') {
      return;
    }

    if (
      (
        node.type === 'url_citation' ||
        node.type === 'citation'
      ) &&
      typeof node.url === 'string' &&
      /^https?:\/\//i.test(node.url)
    ) {
      urls.push(node.url);
    }

    Object.keys(node).forEach(
      function(key) {
        walk(node[key]);
      }
    );
  }

  walk(value);

  return Array.from(
    new Set(urls)
  ).slice(0, 5);
}

function parseGeminiJson_(text) {
  const cleaned = String(text || '')
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
    cleaned.indexOf('{');

  const end =
    cleaned.lastIndexOf('}');

  if (
    start < 0 ||
    end <= start
  ) {
    throw new Error(
      'Gemini response did not contain a JSON object.'
    );
  }

  const result = JSON.parse(
    cleaned.slice(
      start,
      end + 1
    )
  );

  const allowedMatches = [
    'EXACT',
    'LIKELY',
    'NOT_FOUND'
  ];

  const allowedConfidence = [
    'HIGH',
    'MEDIUM',
    'LOW'
  ];

  result.match_status = String(
    result.match_status ||
      'NOT_FOUND'
  ).toUpperCase();

  result.confidence = String(
    result.confidence ||
      'LOW'
  ).toUpperCase();

  if (
    allowedMatches.indexOf(
      result.match_status
    ) < 0
  ) {
    result.match_status =
      'NOT_FOUND';
  }

  if (
    allowedConfidence.indexOf(
      result.confidence
    ) < 0
  ) {
    result.confidence = 'LOW';
  }

  result.website_category =
    normalizeWebsiteCategory_(
      result.website_category
    );

  if (
    !Array.isArray(
      result.highlights
    )
  ) {
    result.highlights = [];
  }

  result.display_name = String(result.display_name || '').trim();

  if (result.display_name.length > 70) {
    result.display_name = '';
  }

  result.highlights = result.highlights
    .map(function(value) {
      return String(value || '').trim();
    })
    .filter(function(value) {
      return value && value.length <= 45;
    })
    .filter(function(value, index, array) {
      const normalized = value.toUpperCase();
      return array.findIndex(function(candidate) {
        return candidate.toUpperCase() === normalized;
      }) === index;
    })
    .slice(0, 6);

  if (
    !Array.isArray(
      result.card_specs
    )
  ) {
    result.card_specs = [];
  }

  /*
   * Reject long or empty values rather than
   * cutting a specification mid-word.
   */
  result.card_specs =
    result.card_specs
      .map(function(value) {
        return String(
          value || ''
        ).trim();
      })
      .filter(function(value) {
        return (
          value &&
          value.length <= 24
        );
      })
      .filter(
        function(value, index, array) {
          const normalized =
            value.toUpperCase();

          return (
            array.findIndex(
              function(candidate) {
                return (
                  candidate.toUpperCase() ===
                  normalized
                );
              }
            ) === index
          );
        }
      )
      .slice(0, 3);

  return result;
}

function normalizeWebsiteCategory_(value) {
  const text = String(value || '').trim();

  if (!text) {
    return '';
  }

  const match = WEBSITE_CATEGORY_VALUES.filter(
    function(category) {
      return category.toLowerCase() === text.toLowerCase();
    }
  )[0];

  return match || '';
}

function applyCatalogEnrichmentResult_(
  sheet,
  rowNumber,
  existingValues,
  result
) {
  const stockImageColumn =
    CATALOG_COLUMNS.STOCK_IMAGE_URL ||
    11;

  const retailSku = String(
    existingValues[
      CATALOG_COLUMNS.RETAIL_SKU - 1
    ] || ''
  ).trim();

  /*
   * A retailer SKU is not automatically a
   * manufacturer model number.
   */
  if (
    isSameComparableValue_(
      result.model,
      retailSku
    )
  ) {
    result.model = '';
  }

  const hasCitation =
    Array.isArray(
      result.sourceUrls
    ) &&
    result.sourceUrls.length > 0;

  /*
   * Customer-facing content may be written only
   * when Gemini establishes an exact,
   * high-confidence, cited match with enough
   * substantive content.
   */
  const verified =
    result.match_status === 'EXACT' &&
    result.confidence === 'HIGH' &&
    hasCitation &&
    result.website_category &&
    String(
      result.description || ''
    ).trim() &&
    Array.isArray(
      result.highlights
    ) &&
    result.highlights.length >= 4;

  if (verified) {
    const fieldMap = [
      [
        CATALOG_COLUMNS.DISPLAY_NAME,
        result.display_name
      ],
      [
        CATALOG_COLUMNS.WEBSITE_CATEGORY,
        result.website_category
      ],
      [
        CATALOG_COLUMNS.BRAND,
        result.brand
      ],
      [
        CATALOG_COLUMNS.MODEL,
        result.model
      ],
      [
        CATALOG_COLUMNS.PRODUCT_URL,
        result.product_url
      ],
      [
        CATALOG_COLUMNS.DESCRIPTION,
        result.description
      ],
      [
        CATALOG_COLUMNS.HIGHLIGHTS,
        (
          result.highlights || []
        ).join('\n')
      ],
      [
        ENRICHMENT_CARD_SPEC_COLUMNS_
          .CARD_SPEC_1,
        (
          result.card_specs || []
        )[0]
      ],
      [
        ENRICHMENT_CARD_SPEC_COLUMNS_
          .CARD_SPEC_2,
        (
          result.card_specs || []
        )[1]
      ],
      [
        ENRICHMENT_CARD_SPEC_COLUMNS_
          .CARD_SPEC_3,
        (
          result.card_specs || []
        )[2]
      ]
    ];

    /*
     * Verified enrichment fills only blank fields.
     * Existing manual content is never overwritten.
     */
    fieldMap.forEach(
      function(entry) {
        const column = entry[0];

        const proposedValue =
          String(
            entry[1] || ''
          ).trim();

        const existingValue =
          String(
            existingValues[
              column - 1
            ] || ''
          ).trim();

        if (
          !existingValue &&
          proposedValue
        ) {
          sheet
            .getRange(
              rowNumber,
              column
            )
            .setValue(
              proposedValue
            );
        }
      }
    );

    const existingImageUrl =
      String(
        existingValues[
          stockImageColumn - 1
        ] || ''
      ).trim();

    const proposedImageUrl =
      String(
        result.stock_image_url ||
          ''
      ).trim();

    if (
      !existingImageUrl &&
      isSafeImageUrl_(
        proposedImageUrl
      )
    ) {
      sheet
        .getRange(
          rowNumber,
          stockImageColumn
        )
        .setValue(
          proposedImageUrl
        );
    }
  }

  const finalStatus =
    verified
      ? 'ENRICHED - VERIFIED'
      : 'NEEDS REVIEW';

  sheet
    .getRange(
      rowNumber,
      CATALOG_COLUMNS.ENRICHMENT_STATUS
    )
    .setValue(finalStatus);

  sheet
    .getRange(
      rowNumber,
      CATALOG_COLUMNS.ENRICHMENT_CONFIDENCE
    )
    .setValue(result.confidence);

  sheet
    .getRange(
      rowNumber,
      CATALOG_COLUMNS.LAST_ENRICHED_AT
    )
    .setValue(new Date());

  const noteParts = [];

  if (result.notes) {
    noteParts.push(
      String(
        result.notes
      ).trim()
    );
  }

  if (
    result.sourceUrls &&
    result.sourceUrls.length
  ) {
    noteParts.push(
      'Sources: ' +
        result.sourceUrls.join(
          ' | '
        )
    );
  }

  if (!verified) {
    noteParts.push(
      'Customer-facing fields were not written because ' +
        'the result was not an exact, high-confidence, ' +
        'cited match.'
    );
  }

  if (!hasCitation) {
    noteParts.push(
      'No Gemini search citation returned.'
    );
  }

  if (noteParts.length) {
    appendCatalogNote_(
      sheet,
      rowNumber,
      noteParts.join('\n')
    );
  }

  return finalStatus;
}

function isSameComparableValue_(
  firstValue,
  secondValue
) {
  const first = String(
    firstValue || ''
  )
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      ''
    );

  const second = String(
    secondValue || ''
  )
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      ''
    );

  return (
    first &&
    second &&
    first === second
  );
}

function isSafeImageUrl_(value) {
  const url = String(
    value || ''
  ).trim();

  if (
    !/^https:\/\//i.test(url)
  ) {
    return false;
  }

  if (/\s/.test(url)) {
    return false;
  }

  /*
   * Do not accept ordinary retailer product pages
   * as direct image URLs.
   */
  if (
    /homedepot\.com\/p\/|lowes\.com\/pd\/|walmart\.com\/ip\//i
      .test(url)
  ) {
    return false;
  }

  return true;
}

function appendCatalogNote_(
  sheet,
  rowNumber,
  newNote
) {
  const cell = sheet.getRange(
    rowNumber,
    CATALOG_COLUMNS.NOTES
  );

  const oldNote = String(
    cell.getValue() || ''
  ).trim();

  const cleanNewNote = String(
    newNote || ''
  ).trim();

  if (!cleanNewNote) {
    return;
  }

  cell.setValue(
    oldNote
      ? oldNote +
          '\n' +
          cleanNewNote
      : cleanNewNote
  );
}