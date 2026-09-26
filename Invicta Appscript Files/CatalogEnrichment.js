
/**
 * Product catalog enrichment through the Gemini Developer API.
 * Existing content is never overwritten; only explicitly queued records are processed.
 * A stock image URL is written only for an exact, cited result.
 *
 * Highlights:
 * - Generated for future eligible products.
 * - Existing Highlights are never overwritten.
 * - Minimum three and maximum five highlights.
 * - Maximum eight words per highlight.
 * - Highlights must be short factual feature/spec phrases.
 * - Long highlights are rejected rather than truncated.
 *
 * Card Specs:
 * - Generated for future eligible products.
 * - Existing Card Specs are never overwritten.
 * - Maximum three specs.
 * - Maximum 24 characters per spec.
 */


/*
 * HIGHLIGHT RULES
 *
 * Keep these constraints here as the authoritative code-side
 * validation rules. Gemini is instructed to follow the same rules,
 * but its output is still validated before anything is written.
 */
const ENRICHMENT_HIGHLIGHT_RULES_ = Object.freeze({
  MIN_COUNT: 3,
  MAX_COUNT: 5,
  MAX_WORDS: 8
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

    const columns = getCatalogColumns_(sheet);
    const lastRow = getLastDataRowInColumn_(sheet, columns.PRODUCT_KEY);

    if (lastRow < 2) {
      return summary;
    }

    const lastRequiredColumn = sheet.getLastColumn();

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
          values, columns
        )
      ) {
        continue;
      }

      const rowNumber = index + 2;
      summary.processed++;

      sheet
        .getRange(
          rowNumber,
          columns.ENRICHMENT_STATUS
        )
        .setValue('PROCESSING');

      SpreadsheetApp.flush();

      try {
        const record =
          catalogRowToEnrichmentRecord_(
            values,
            rowNumber, columns
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
            result, columns
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
            columns.ENRICHMENT_STATUS
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


function isCatalogRowEligibleForEnrichment_(values, columns) {
  const key = normalizeKey_(values[columns.PRODUCT_KEY - 1]);
  const item = catalogText_(values[columns.SOURCE_ITEM - 1]);
  const status = normalizeKey_(values[columns.ENRICHMENT_STATUS - 1]);
  // Historical permanent identities are excluded even when marked PENDING.
  // The bulk queue helper does not constitute permission to research legacy products.
  if (/^(LEG-|LEGACY\|)/.test(key)) return false;
  const description = catalogText_(values[columns.DESCRIPTION - 1]);
  const highlights = catalogText_(values[columns.HIGHLIGHTS - 1]);
  // Preserve the previous completed-content guard; optional missing specs alone
  // must not trigger another Gemini request for already populated products.
  if (description && highlights) return false;
  // Only missing-content blank/PENDING rows enter the automatic queue.
  return Boolean(key && item && (!status || status === 'PENDING'));
}


function catalogRowToEnrichmentRecord_(
  values,
  rowNumber, columns
) {
  return {
    rowNumber: rowNumber,

    productKey: String(
      values[
        columns.PRODUCT_KEY - 1
      ] || ''
    ).trim(),

    retailer: String(
      values[
        columns.RETAILER - 1
      ] || ''
    ).trim(),

    retailSku: String(
      values[
        columns.RETAIL_SKU - 1
      ] || ''
    ).trim(),

    sourceItem: String(
      values[
        columns.SOURCE_ITEM - 1
      ] || ''
    ).trim(),

    websiteCategory: String(
      values[
        columns.WEBSITE_CATEGORY - 1
      ] || ''
    ).trim(),

    existingDisplayName: String(
      values[
        columns.DISPLAY_NAME - 1
      ] || ''
    ).trim(),

    existingBrand: String(
      values[
        columns.BRAND - 1
      ] || ''
    ).trim(),

    existingModel: String(
      values[
        columns.MODEL - 1
      ] || ''
    ).trim(),

    existingUrl: String(
      values[
        columns.PRODUCT_URL - 1
      ] || ''
    ).trim(),

    existingCardSpec1: String(
      values[
        columns
          .CARD_SPEC_1 - 1
      ] || ''
    ).trim(),

    existingCardSpec2: String(
      values[
        columns
          .CARD_SPEC_2 - 1
      ] || ''
    ).trim(),

    existingCardSpec3: String(
      values[
        columns
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
    '',
    'Retailer: ' + record.retailer,
    'Retail SKU: ' + record.retailSku,
    'Inventory title: ' + record.sourceItem,
    'Website category: ' +
      record.websiteCategory,
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
    '  "web_subcategory": "",',
    '  "unit_type": "",',
    '  "sq_ft_per_unit": null,',
    '  "thickness_mm": null,',
    '  "wear_layer_mil": null,',
    '  "underlayment_attached": "Yes|No or empty",',
    '  "water_resistance": "Waterproof|Water Resistant|Not Water Resistant|Unknown or empty",',
    '  "product_url": "",',
    '  "stock_image_url": "",',
    '  "description": "",',
    '  "highlights": ["3 to 5 short factual feature phrases"],',
    '  "card_specs": ["", "", ""],',
    '  "confidence": "HIGH|MEDIUM|LOW",',
    '  "notes": ""',
    '}',
    '',
    'Only return applicable verified attributes; flooring specs must describe the exact SKU/model.',
    'Use null or empty values for unknown/inapplicable fields. Never infer thickness, wear layer or pack area.',
    'Description must be two concise factual sentences suitable for a product catalog.',
    '',
    'HIGHLIGHT RULES:',
    'Return 3 to 5 highlights only.',
    'Each highlight must contain no more than 8 words.',
    'Write highlights as short feature or specification phrases, not complete marketing sentences.',
    'Prefer concrete customer-useful facts such as material, size, technology, compatibility, construction, included components, or important functionality.',
    'Highlights must be factual, verified, non-repetitive, and must not include price.',
    'Do not repeat the brand, model, retailer, SKU, or full product name in highlights.',
    'Do not use promotional wording such as "premium", "best", "powerful", "excellent", or "ideal" unless it is part of a verified formal product designation.',
    'Do not invent benefits from a specification.',
    'Examples of acceptable highlights: "Brushless motor", "Anti-rotation safety system", "XR battery and charger included", "IPX7 waterproof construction", "Soft-close drawer slides".',
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


/*
 * HIGHLIGHT RULES
 *
 * Gemini is asked to return short highlights, but prompt
 * instructions alone are not sufficient. Validate them
 * deterministically before customer-facing content is written.
 *
 * Long highlights are rejected rather than truncated because
 * truncating could alter the meaning of a verified fact.
 */
function sanitizeGeminiHighlights_(highlights) {
  if (!Array.isArray(highlights)) {
    return [];
  }

  return highlights
    .map(function(value) {
      return String(
        value || ''
      )
        .replace(/\s+/g, ' ')
        .trim();
    })
    .filter(function(value) {
      if (!value) {
        return false;
      }

      const wordCount =
        value.split(/\s+/).length;

      return (
        wordCount <=
        ENRICHMENT_HIGHLIGHT_RULES_.MAX_WORDS
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
    .slice(
      0,
      ENRICHMENT_HIGHLIGHT_RULES_.MAX_COUNT
    );
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

  /*
   * HIGHLIGHT RULES
   *
   * Reject oversized highlights instead of trusting Gemini's
   * interpretation of "concise".
   */
  result.highlights =
    sanitizeGeminiHighlights_(
      result.highlights
    );

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


function applyCatalogEnrichmentResult_(
  sheet,
  rowNumber,
  existingValues,
  result, columns
) {
  columns = columns || getCatalogColumns_(sheet);
  const latestValues = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (normalizeKey_(latestValues[columns.PRODUCT_KEY - 1]) !== normalizeKey_(existingValues[columns.PRODUCT_KEY - 1]) ||
      catalogText_(latestValues[columns.RETAIL_SKU - 1]) !== catalogText_(existingValues[columns.RETAIL_SKU - 1])) {
    throw new Error('Product identity changed while enrichment was running; review and requeue.');
  }
  // Human edits can occur during the API call despite the script lock.
  existingValues = latestValues;
  const stockImageColumn = columns.STOCK_IMAGE_URL;
  result = Object.assign({}, result, { highlights: sanitizeGeminiHighlights_(result.highlights) });

  const retailSku = String(
    existingValues[
      columns.RETAIL_SKU - 1
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
   *
   * HIGHLIGHT RULES:
   * Sanitization has already happened in
   * parseGeminiJson_. At least three valid short
   * highlights must survive validation.
   */
  const verified =
    result.match_status === 'EXACT' &&
    result.confidence === 'HIGH' &&
    hasCitation &&
    String(
      result.description || ''
    ).trim() &&
    Array.isArray(
      result.highlights
    ) &&
    result.highlights.length >=
      ENRICHMENT_HIGHLIGHT_RULES_.MIN_COUNT;

  if (verified) {
    const fieldMap = [
      [columns.DISPLAY_NAME, result.display_name],
      [columns.WEBSITE_CATEGORY, result.website_category],
      [columns.BRAND, result.brand],
      [columns.MODEL, result.model],
      [columns.WEB_SUBCATEGORY, result.web_subcategory],
      [columns.UNIT_TYPE, result.unit_type],
      [columns.SQ_FT_PER_UNIT, enrichmentPositiveNumber_(result.sq_ft_per_unit)],
      [columns.PRODUCT_URL, result.product_url],
      [columns.DESCRIPTION, result.description],
      [columns.HIGHLIGHTS, (result.highlights || []).join('\n')],
      [columns.THICKNESS_MM, enrichmentPositiveNumber_(result.thickness_mm)],
      [columns.WEAR_LAYER_MIL, enrichmentPositiveNumber_(result.wear_layer_mil)],
      [columns.UNDERLAYMENT_ATTACHED, enrichmentEnum_(result.underlayment_attached, ['Yes', 'No'])],
      [columns.WATER_RESISTANCE, enrichmentEnum_(result.water_resistance, ['Waterproof', 'Water Resistant', 'Not Water Resistant', 'Unknown'])],
      [columns.CARD_SPEC_1, enrichmentCardSpec_((result.card_specs || [])[0])],
      [columns.CARD_SPEC_2, enrichmentCardSpec_((result.card_specs || [])[1])],
      [columns.CARD_SPEC_3, enrichmentCardSpec_((result.card_specs || [])[2])]
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

        const existingValue = catalogText_(existingValues[column - 1]);

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
              typeof entry[1] === 'number' ? entry[1] : proposedValue
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
      columns.ENRICHMENT_STATUS
    )
    .setValue(finalStatus);



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
        'cited match with at least ' +
        ENRICHMENT_HIGHLIGHT_RULES_.MIN_COUNT +
        ' valid short highlights.'
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
    getCatalogColumns_(sheet).NOTES
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

function enrichmentPositiveNumber_(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : '';
}
function enrichmentEnum_(value, allowed) {
  return allowed.find(function(item) { return item.toLowerCase() === catalogText_(value).toLowerCase(); }) || '';
}
function enrichmentCardSpec_(value) {
  const text = catalogText_(value);
  return text.length <= 24 ? text : '';
}

