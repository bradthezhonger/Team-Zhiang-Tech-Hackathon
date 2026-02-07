function getGoogleMapsDirectionsLink(lat, lng) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; 

    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; 

}

const aiCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; 

async function ai(prompt) {

  const cacheKey = prompt.substring(0, 100);
  const cached = aiCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.response;
  }

  const res = await fetch("http://10.0.0.58:6767/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "google/gemma-3-4b",
      messages: [
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      stream: false
    })
  });

  const data = await res.json();
  let response = data.choices[0].message.content;

  response = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  aiCache.set(cacheKey, { response, timestamp: Date.now() });

  return response;
}

async function filterResultsWithAI(itemName, results, resultType) {
  if (!results || results.length === 0) return [];

  try {

    let resultDescriptions = "";
    if (resultType === "recycle" || resultType === "repair") {
      resultDescriptions = results.map((r, i) => 
        `${i + 1}. ${r.name} - ${r.address || ""}`
      ).join("\n");
    } else if (resultType === "borrow") {
      resultDescriptions = results.map((r, i) => 
        `${i + 1}. ${r.productname} - ${r.description || ""}`
      ).join("\n");
    }

    const prompt = `User is looking for "${itemName}" to ${resultType}.
Evaluate each result's relevance on a scale of 0-10 (10 = highly relevant, 0 = irrelevant).
Filter out results with score below 5.

Results:
${resultDescriptions}

Return ONLY a JSON array of objects with "index" (1-based), "score" (0-10), and "reason" (brief 3-5 word explanation) for relevant results.
Example: [{"index":1,"score":9,"reason":"Specializes in this item"},{"index":3,"score":7,"reason":"Nearby and highly rated"}]`;

    const response = await ai(prompt);
    const scores = JSON.parse(response.trim());

    const filteredResults = scores
      .filter(s => s.score >= 5)
      .map(s => ({
        ...results[s.index - 1],
        aiScore: s.score,
        aiRelevance: s.score >= 8 ? "high" : s.score >= 6 ? "medium" : "low",
        aiReason: s.reason || ""
      }))
      .sort((a, b) => b.aiScore - a.aiScore);

    return filteredResults;
  } catch (err) {
    console.error("AI filtering failed, returning unfiltered:", err);
    return results;
  }
}

let usercategory = null;
let currentItemName = "";

let fullRecycleResults = [];
let fullRepairResults = [];

async function generateEcoTip(itemName, action) {
  try {
    const prompt = `Generate a short, interesting eco-fact or tip about ${action}ing "${itemName}". 
Make it 1-2 sentences, start with "💡" emoji, and be specific about environmental impact or benefits.
Example: "💡 Recycling one aluminum can saves enough energy to power a TV for 3 hours!"
Your response:`;

    const tip = await ai(prompt);
    return tip.trim();
  } catch (err) {
    console.error("Eco-tip generation failed:", err);
    return null;
  }
}

async function suggestBestAction(itemName, category) {
  try {
    const prompt = `For the item "${itemName}" (category: ${category}), which action is most beneficial: Reuse, Reduce, or Recycle?
Provide a brief reason (1 sentence).
Return ONLY a JSON object: {"action": "Reuse|Reduce|Recycle", "reason": "brief explanation"}
Your response:`;

    const response = await ai(prompt);
    const suggestion = JSON.parse(response.trim());
    return suggestion;
  } catch (err) {
    console.error("Action suggestion failed:", err);
    return null;
  }
}

function showSmartSuggestion(suggestion) {
  if (!suggestion) return;

  const existing = document.getElementById("smart-suggestion");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.id = "smart-suggestion";
  banner.className = "smart-suggestion";
  banner.innerHTML = `
    <div class="smart-suggestion__content">
      <span class="smart-suggestion__icon">✨</span>
      <div class="smart-suggestion__text">
        <strong>AI suggests: ${escapeHtml(suggestion.action)}</strong>
        <p>${escapeHtml(suggestion.reason)}</p>
      </div>
    </div>
  `;

  const choices = document.getElementById("choices");
  if (choices) {
    choices.parentNode.insertBefore(banner, choices);
  }
}

function showEcoTip(tip, container) {
  if (!tip || !container) return;

  const existing = container.querySelector(".eco-tip-card");
  if (existing) existing.remove();

  const tipCard = document.createElement("div");
  tipCard.className = "eco-tip-card";
  tipCard.innerHTML = `<p>${tip}</p>`;

  const title = container.querySelector("h1");
  if (title && title.nextSibling) {
    container.insertBefore(tipCard, title.nextSibling);
  } else {
    container.insertBefore(tipCard, container.firstChild);
  }
}

async function submitItemAndClassify() {
  const itemInput = document.getElementById("item-input");
  const itemText = (itemInput && itemInput.value) ? itemInput.value.trim() : "";
  currentItemName = itemText;

  const prompt =
    "You must respond with exactly one of these category names, nothing else: E-waste, Fashion, Tools. " +
    "Which category does this item belong to? Reply with only the category name.\nItem: " + itemText;
  try {
    const raw = await ai(prompt);
    const trimmed = (raw || "").trim();
    const match = trimmed.match(/\b(E-waste|Fashion|Tools)\b/i);
    if (match) {
      const lower = match[1].toLowerCase();
      usercategory = lower === "e-waste" ? "E-waste" : lower === "fashion" ? "Fashion" : "Tools";
    } else {
      usercategory = null;
    }

    if (usercategory && itemText) {
      const suggestion = await suggestBestAction(itemText, usercategory);
      if (suggestion) {
        showSmartSuggestion(suggestion);
      }
    }
  } catch (err) {
    console.error("AI category classification failed:", err);
    usercategory = null;
  }
  const page = document.getElementById("page");
  if (page) page.classList.add("is-submitted");
}

window.submitItemAndClassify = submitItemAndClassify;

async function getUserLocation() {
    const apiKey = "4d544e168bb14b82b3665ba652ed5b56";
    const url = `https://api.geoapify.com/v1/ipinfo?apiKey=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        const loc = data?.location;
        const lat = loc?.latitude;
        const lon = loc?.longitude;
        const city = data?.city?.name ?? data?.city ?? "";

        if (lat == null || lon == null) {
            console.warn("Location coordinates missing in API response", data);
            return null;
        }
        return { lat, lon, city };
    } catch (err) {
        console.error("Error detecting location:", err);
        return null;
    }
}

const categoryMap = {
    "E-waste": "service.recycling.centre,service.recycling,commercial.elektronics",
    "Fashion": "commercial.clothing,commercial.second_hand",
    "Tools": "commercial.houseware_and_hardware.hardware_and_tools,commercial.houseware_and_hardware"
};

const repairCategoryMap = {
    "E-waste": "service.vehicle.repair,service.vehicle.repair.car",
    "Fashion": "service.tailor",
    "Tools": "service.vehicle.repair,service.vehicle.repair.car"
};

async function queryResults(category, lat, lon) {
    const apiKey = "4d544e168bb14b82b3665ba652ed5b56";
    const geoCategory = categoryMap[category];

    if (!geoCategory) {
        console.error("Unknown category:", category);
        return [];
    }

    const radius = 5000; 

    const limit = 10;

    const url = `https://api.geoapify.com/v2/places?categories=${geoCategory}&filter=circle:${lon},${lat},${radius}&limit=${limit}&apiKey=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            console.error("Places API error:", data.message || data.error);
            return [];
        }

        const features = data.features;
        if (!Array.isArray(features)) {
            console.warn("Places API: no features array in response", data);
            return [];
        }

        const results = features.map(feature => {
            const coords = feature.geometry?.coordinates;
            let distance = feature.properties?.distance || 0;

            if (coords && coords.length >= 2 && distance === 0) {
                distance = calculateDistance(lat, lon, coords[1], coords[0]);
            }

            return {
                name: feature.properties?.name ?? "",
                address: feature.properties?.address_line1 || "",
                city: feature.properties?.city || "",
                distance: distance,
                website: feature.properties?.website || "",
                coordinates: coords
            };
        });

        return results;
    } catch (err) {
        console.error("Error fetching Places API:", err);
        return [];
    }
}

async function generateEmptyStateSuggestions(itemName, actionType) {
  try {
    const prompt = `User searched for "${itemName}" to ${actionType} but found no results.
Suggest 2-3 helpful alternatives or explain why (1-2 sentences).
Return ONLY plain text suggestion.
Example: "Try searching for broader terms like 'electronics' or check online platforms like Craigslist."
Your response:`;

    const suggestion = await ai(prompt);
    return suggestion.trim();
  } catch (err) {
    console.error("Empty state suggestion failed:", err);
    return null;
  }
}

async function renderRecycleResults(container, results) {
    if (!container) return;
    const list = Array.isArray(results) ? results : [];
    if (list.length === 0) {
        let emptyMessage = "No recycling centers found nearby for this category. Try another item or check back later.";

        if (currentItemName) {
          const suggestion = await generateEmptyStateSuggestions(currentItemName, "recycle");
          if (suggestion) {
            emptyMessage = `<p><strong>No results found</strong></p><p class="suggestion-text">${escapeHtml(suggestion)}</p>`;
          }
        }

        container.innerHTML = `
          <div class="recycle-results recycle-results--empty">
            ${emptyMessage}
          </div>`;
        return;
    }
    container.innerHTML = `
      <div class="recycle-results">
        ${list
            .map(
                (place) => `
          <article class="recycle-result-card ${place.aiRelevance ? 'has-ai-score' : ''}">
            ${place.aiRelevance ? `<span class="relevance-badge relevance-badge--${place.aiRelevance}">${place.aiScore}/10</span>` : ""}
            <h3 class="recycle-result-card__title">${escapeHtml(place.name || "Recycling center")}</h3>
            ${place.aiReason ? `<p class="ai-reason">✓ ${escapeHtml(place.aiReason)}</p>` : ""}
            <p class="recycle-result-card__address">${escapeHtml([place.address, place.city].filter(Boolean).join(", ") || "Address not provided")}</p>
            ${place.distance != null ? `<p class="recycle-result-card__distance">${formatDistance(place.distance)}</p>` : ""}
            ${place.coordinates && place.coordinates.length >= 2 ? `<p><a href="${getGoogleMapsDirectionsLink(place.coordinates[1], place.coordinates[0])}" target="_blank" rel="noopener">Get Directions</a></p>` : ""}
          </article>`
            )
            .join("")}
      </div>`;
}

const recycleLink = document.getElementById("recycle-link");
const recycleView = document.getElementById("recycle-view");
if (recycleLink && recycleView) {
    recycleLink.addEventListener("click", async function (e) {
        e.preventDefault();

        const smartSuggestion = document.getElementById("smart-suggestion");
        if (smartSuggestion) smartSuggestion.remove();

        const page = document.getElementById("page");
        if (page) {
            page.classList.add("is-recycle-view");
            recycleView.removeAttribute("hidden");
        }
        const content = recycleView.querySelector(".recycle-view__content");
        const category = usercategory || "E-waste";

        showLoadingState(content, "Finding recycling centers...");

        try {
            const location = await getUserLocation();
            if (!location) {
                if (content) {
                    content.innerHTML = `<div class="recycle-results recycle-results--empty"><p>We couldn’t detect your location. Enable location or try again later.</p></div>`;
                }
                return;
            }
            let results = await queryResults(category, location.lat, location.lon);

            if (results.length > 0 && currentItemName) {
                showLoadingState(content, "AI is ranking results...");
                results = await filterResultsWithAI(currentItemName, results, "recycle");
            }

            fullRecycleResults = results;

            renderRecycleResults(content, results);

            setupDistanceFilter("distance-filter-recycle", renderRecycleResults, () => fullRecycleResults);

            if (currentItemName) {
              const tip = await generateEcoTip(currentItemName, "recycl");
              if (tip) showEcoTip(tip, content.parentElement);
            }
        } catch (err) {
            console.error("Recycle view load failed:", err);
            if (content) renderRecycleResults(content, []);
        }
    });
}

async function renderBorrowResults(container, items) {
  if (!container) return;
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    let emptyMessage = "No items match your query yet. Try another search or check back later.";

    if (currentItemName) {
      const suggestion = await generateEmptyStateSuggestions(currentItemName, "borrow");
      if (suggestion) {
        emptyMessage = `<p><strong>No items available</strong></p><p class="suggestion-text">${escapeHtml(suggestion)}</p>`;
      }
    }

    container.innerHTML = `
      <div class="borrow-results borrow-results--empty">
        ${emptyMessage}
      </div>`;
    container.classList.add("borrow-results-wrapper");
    return;
  }
  container.classList.add("borrow-results-wrapper");
  container.innerHTML = `
    <div class="borrow-results">
      ${list
        .map(
          (item) => `
        <article class="borrow-result-card ${item.aiRelevance ? 'has-ai-score' : ''}">
          ${item.aiRelevance ? `<span class="relevance-badge relevance-badge--${item.aiRelevance}">${item.aiScore}/10</span>` : ""}
          <h3 class="borrow-result-card__title">${escapeHtml(item.productname || "Item")}</h3>
          ${item.aiReason ? `<p class="ai-reason">✓ ${escapeHtml(item.aiReason)}</p>` : ""}
          <p class="borrow-result-card__description">${escapeHtml(item.description || "No description available")}</p>
          <div class="borrow-result-card__contact">
            <p><strong>Contact:</strong> ${escapeHtml(item.name || "Anonymous")}</p>
            <p>${item.email ? `<a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>` : ""}</p>
            <p>${item.phonenum ? `<a href="tel:${escapeHtml(item.phonenum)}">${escapeHtml(item.phonenum)}</a>` : ""}</p>
          </div>
        </article>`
        )
        .join("")}
    </div>`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatDistance(meters) {
  const miles = meters * 0.000621371;
  if (miles < 0.1) {
    const feet = Math.round(miles * 5280);
    return `${feet} ft away`;
  } else {
    return `${miles.toFixed(1)} mi away`;
  }
}

function filterByDistance(results, maxDistance) {
  if (maxDistance === "all") return results;
  const max = parseInt(maxDistance);
  return results.filter(r => r.distance != null && r.distance <= max);
}

function setupDistanceFilter(filterId, renderFunction, getResults) {
  const filterContainer = document.getElementById(filterId);
  if (!filterContainer) return;

  const buttons = filterContainer.querySelectorAll(".distance-filter__btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {

      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const distance = btn.dataset.distance;

      const allResults = getResults();
      const filtered = filterByDistance(allResults, distance);
      const content = filterContainer.nextElementSibling;
      renderFunction(content, filtered);
    });
  });
}

function showLoadingState(container, message) {
  if (!container) return;
  container.innerHTML = `
    <div class="loading-spinner">
      <div class="spinner"></div>
      <p>${escapeHtml(message || "Loading...")}</p>
    </div>`;
}

function navigateBack() {
  const page = document.getElementById("page");
  if (!page) return;

  page.className = "page is-submitted";

  const smartSuggestion = document.getElementById("smart-suggestion");
  if (smartSuggestion) smartSuggestion.remove();

  document.querySelectorAll("section").forEach(el => {
    if (!el.classList.contains("choices") && el.id !== "choices") {
      el.setAttribute("hidden", "");
    }
  });

  const choices = document.getElementById("choices");
  if (choices) choices.removeAttribute("hidden");
}

let autocompleteDebounce = null;
async function generateAutocompleteSuggestions(partial) {
  if (!partial || partial.length < 3) return [];

  try {
    const prompt = `Given this partial input: "${partial}", suggest 5 complete, common items that people might want to reuse, recycle, or repair.
Return ONLY a JSON array of strings. Be specific and practical.
Example: ["laptop computer", "plastic water bottles", "old clothing"]
Your response:`;

    const response = await ai(prompt);
    const suggestions = JSON.parse(response.trim());
    return Array.isArray(suggestions) ? suggestions.slice(0, 5) : [];
  } catch (err) {
    console.error("Autocomplete generation failed:", err);
    return [];
  }
}

function showAutocompleteSuggestions(suggestions) {
  const dropdown = document.getElementById("autocomplete-dropdown");
  const input = document.getElementById("item-input");

  if (!dropdown || !suggestions || suggestions.length === 0) {
    if (dropdown) dropdown.setAttribute("hidden", "");
    return;
  }

  dropdown.innerHTML = suggestions.map(suggestion => 
    `<div class="autocomplete-item" data-value="${escapeHtml(suggestion)}">
      ${escapeHtml(suggestion)}
    </div>`
  ).join("");

  dropdown.removeAttribute("hidden");

  dropdown.querySelectorAll(".autocomplete-item").forEach(item => {
    item.addEventListener("click", () => {
      if (input) input.value = item.dataset.value;
      dropdown.setAttribute("hidden", "");
    });
  });
}

const itemInput = document.getElementById("item-input");
if (itemInput) {
  itemInput.addEventListener("input", async (e) => {
    const value = e.target.value.trim();

    if (autocompleteDebounce) clearTimeout(autocompleteDebounce);

    if (value.length < 3) {
      const dropdown = document.getElementById("autocomplete-dropdown");
      if (dropdown) dropdown.setAttribute("hidden", "");
      return;
    }

    autocompleteDebounce = setTimeout(async () => {
      const suggestions = await generateAutocompleteSuggestions(value);
      showAutocompleteSuggestions(suggestions);
    }, 300);
  });

  document.addEventListener("click", (e) => {
    const dropdown = document.getElementById("autocomplete-dropdown");
    if (dropdown && !itemInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.setAttribute("hidden", "");
    }
  });
}

async function enhanceItemSearch(query, results) {
  if (!results || results.length === 0) return results;

  try {

    const itemNames = results.map(r => r.productname).join(", ");
    const prompt = `User is searching for: "${query}"
Available items: ${itemNames}

Rank these items by relevance to the search query. Return a JSON array of item names in order of relevance (most relevant first).
Only return the JSON array, nothing else.`;

    const response = await ai(prompt);
    const ranked = JSON.parse(response.trim());

    const rankedResults = [];
    for (const itemName of ranked) {
      const match = results.find(r => r.productname === itemName);
      if (match) rankedResults.push(match);
    }

    for (const item of results) {
      if (!rankedResults.includes(item)) {
        rankedResults.push(item);
      }
    }

    return rankedResults;
  } catch (err) {
    console.error("AI ranking failed, using original order:", err);
    return results;
  }
}

const reuseBorrowBtn = document.getElementById("reuse-borrow-btn");
const reuseBorrowView = document.getElementById("reuse-borrow-view");
if (reuseBorrowBtn && reuseBorrowView) {
  reuseBorrowBtn.addEventListener("click", async function () {
    const content = reuseBorrowView.querySelector(".reuse-result-view__content");
    const itemInput = document.getElementById("item-input");
    const query = (itemInput && itemInput.value) ? itemInput.value.trim() : "";

    showLoadingState(content, "Searching for items...");

    try {
      const raw = await getItem(query);
      let results = Array.isArray(raw) ? raw : [];

      if (results.length > 0 && query) {
        showLoadingState(content, "AI is ranking results...");
        results = await filterResultsWithAI(query, results, "borrow");
      }

      renderBorrowResults(content, results);
    } catch (err) {
      console.error("Borrow search failed:", err);
      renderBorrowResults(content, []);
    }
  });
}

async function queryRepairShops(category, lat, lon) {
    const apiKey = "4d544e168bb14b82b3665ba652ed5b56";
    const repairCategory = repairCategoryMap[category];

    if (!repairCategory) {
        console.error("Unknown category for repair:", category);
        return [];
    }

    const radius = 5000; 

    const limit = 10;

    const url = `https://api.geoapify.com/v2/places?categories=${repairCategory}&filter=circle:${lon},${lat},${radius}&limit=${limit}&apiKey=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            console.error("Places API error:", data.message || data.error);
            return [];
        }

        const features = data.features;
        if (!Array.isArray(features)) {
            console.warn("Places API: no features array in response", data);
            return [];
        }

        const results = features.map(feature => {
            const coords = feature.geometry?.coordinates;
            let distance = feature.properties?.distance || 0;

            if (coords && coords.length >= 2 && distance === 0) {
                distance = calculateDistance(lat, lon, coords[1], coords[0]);
            }

            return {
                name: feature.properties?.name ?? "Repair Shop",
                address: feature.properties?.address_line1 || "",
                city: feature.properties?.city || "",
                distance: distance,
                website: feature.properties?.website || "",
                phone: feature.properties?.phone || "",
                coordinates: coords
            };
        });

        return results;
    } catch (err) {
        console.error("Error fetching repair shops:", err);
        return [];
    }
}

async function renderRepairResults(container, results) {
  if (!container) return;
  const list = Array.isArray(results) ? results : [];
  if (list.length === 0) {
    let emptyMessage = "No repair shops found nearby. Try expanding your search area or check online services.";

    if (currentItemName) {
      const suggestion = await generateEmptyStateSuggestions(currentItemName, "repair");
      if (suggestion) {
        emptyMessage = `<p><strong>No repair shops found</strong></p><p class="suggestion-text">${escapeHtml(suggestion)}</p>`;
      }
    }

    container.innerHTML = `
      <div class="repair-results repair-results--empty">
        ${emptyMessage}
      </div>`;
    return;
  }
  container.innerHTML = `
    <div class="repair-results">
      ${list
        .map(
          (shop) => `
        <article class="repair-result-card ${shop.aiRelevance ? 'has-ai-score' : ''}">
          ${shop.aiRelevance ? `<span class="relevance-badge relevance-badge--${shop.aiRelevance}">${shop.aiScore}/10</span>` : ""}
          <h3 class="repair-result-card__title">${escapeHtml(shop.name || "Repair Shop")}</h3>
          ${shop.aiReason ? `<p class="ai-reason">✓ ${escapeHtml(shop.aiReason)}</p>` : ""}
          <p class="repair-result-card__address">${escapeHtml([shop.address, shop.city].filter(Boolean).join(", ") || "Address not provided")}</p>
          ${shop.phone ? `<p class="repair-result-card__phone"><a href="tel:${escapeHtml(shop.phone)}">${escapeHtml(shop.phone)}</a></p>` : ""}
          ${shop.distance != null ? `<p class="repair-result-card__distance">${formatDistance(shop.distance)}</p>` : ""}
          ${shop.coordinates && shop.coordinates.length >= 2 ? `<p><a href="${getGoogleMapsDirectionsLink(shop.coordinates[1], shop.coordinates[0])}" target="_blank" rel="noopener">Get Directions</a></p>` : ""}
        </article>`
        )
        .join("")}
    </div>`;
}

const reduceLink = document.getElementById("reduce-link");
const reduceView = document.getElementById("reduce-view");
if (reduceLink && reduceView) {
    reduceLink.addEventListener("click", async function (e) {
        e.preventDefault();

        const smartSuggestion = document.getElementById("smart-suggestion");
        if (smartSuggestion) smartSuggestion.remove();

        const page = document.getElementById("page");
        if (page) {
            page.classList.add("is-reduce-view");
            reduceView.removeAttribute("hidden");
        }
        const content = reduceView.querySelector(".reduce-view__content");
        const category = usercategory || "E-waste";

        showLoadingState(content, "Finding repair shops...");

        try {
            const location = await getUserLocation();
            if (!location) {
                if (content) {
                    content.innerHTML = `<div class="repair-results repair-results--empty"><p>We couldn't detect your location. Enable location or try again later.</p></div>`;
                }
                return;
            }
            let results = await queryRepairShops(category, location.lat, location.lon);

            if (results.length > 0 && currentItemName) {
                showLoadingState(content, "AI is ranking results...");
                results = await filterResultsWithAI(currentItemName, results, "repair");
            }

            fullRepairResults = results;

            renderRepairResults(content, results);

            setupDistanceFilter("distance-filter-reduce", renderRepairResults, () => fullRepairResults);

            if (currentItemName) {
              const tip = await generateEcoTip(currentItemName, "repair");
              if (tip) showEcoTip(tip, content.parentElement);
            }
        } catch (err) {
            console.error("Reduce view load failed:", err);
            if (content) renderRepairResults(content, []);
        }
    });
}

const API_URL = "http://127.0.0.1:8000/api.php";

async function postItem(productname, description, name, email, phonenum) {
    const url =
        `${API_URL}?productname=${encodeURIComponent(productname)}` +
        `&description=${encodeURIComponent(description)}` +
        `&name=${encodeURIComponent(name)}` +
        `&email=${encodeURIComponent(email)}` +
        `&phonenum=${encodeURIComponent(phonenum)}`;

    const response = await fetch(url);
    return await response.json();
}

async function getItem(searchQuery) {
    const url = `${API_URL}?query=${encodeURIComponent(searchQuery)}`;
    const response = await fetch(url);
    return await response.json();
}

const aiDescriptionBtn = document.getElementById("ai-description-btn");
if (aiDescriptionBtn) {
  aiDescriptionBtn.addEventListener("click", async function () {
    const itemInput = document.getElementById("item-input");
    const descriptionTextarea = document.getElementById("lend-description");
    const itemName = (itemInput && itemInput.value) ? itemInput.value.trim() : "";

    if (!itemName) {
      alert("Please enter an item name first!");
      return;
    }

    const originalText = aiDescriptionBtn.textContent;
    aiDescriptionBtn.textContent = "Generating...";
    aiDescriptionBtn.disabled = true;

    try {
      const prompt = `Write a short, friendly 2-3 sentence description for someone lending out this item: "${itemName}". 
Include condition (assume good), what it's useful for, and why someone might want to borrow it.
Keep it casual and inviting. Do not include a title or item name at the start.`;

      const description = await ai(prompt);
      if (descriptionTextarea) {
        descriptionTextarea.value = description.trim();
      }
    } catch (err) {
      console.error("AI description generation failed:", err);
      alert("Failed to generate description. Please try again.");
    } finally {
      aiDescriptionBtn.textContent = originalText;
      aiDescriptionBtn.disabled = false;
    }
  });
}

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePhone(phone) {
  const phoneRegex = /^[\d\s\-\+\(\)]+$/;
  return phone.length >= 10 && phoneRegex.test(phone);
}

function showFieldError(field, message) {
  field.classList.add("input-error");
  let errorDiv = field.parentElement.querySelector(".field-error");
  if (!errorDiv) {
    errorDiv = document.createElement("div");
    errorDiv.className = "field-error";
    field.parentElement.appendChild(errorDiv);
  }
  errorDiv.textContent = message;
}

function clearFieldError(field) {
  field.classList.remove("input-error");
  const errorDiv = field.parentElement.querySelector(".field-error");
  if (errorDiv) errorDiv.remove();
}

function setupFormValidation() {
  const emailField = document.getElementById("lend-email");
  const phoneField = document.getElementById("lend-phone");
  const nameField = document.getElementById("lend-name");
  const descField = document.getElementById("lend-description");

  if (emailField) {
    emailField.addEventListener("blur", () => {
      const value = emailField.value.trim();
      if (value && !validateEmail(value)) {
        showFieldError(emailField, "Please enter a valid email address");
      } else {
        clearFieldError(emailField);
      }
    });
    emailField.addEventListener("input", () => {
      if (emailField.classList.contains("input-error")) {
        clearFieldError(emailField);
      }
    });
  }

  if (phoneField) {
    phoneField.addEventListener("blur", () => {
      const value = phoneField.value.trim();
      if (value && !validatePhone(value)) {
        showFieldError(phoneField, "Please enter a valid phone number");
      } else {
        clearFieldError(phoneField);
      }
    });
    phoneField.addEventListener("input", () => {
      if (phoneField.classList.contains("input-error")) {
        clearFieldError(phoneField);
      }
    });
  }

  if (nameField) {
    nameField.addEventListener("blur", () => {
      const value = nameField.value.trim();
      if (value && value.length < 2) {
        showFieldError(nameField, "Name must be at least 2 characters");
      } else {
        clearFieldError(nameField);
      }
    });
  }

  if (descField) {
    descField.addEventListener("blur", () => {
      const value = descField.value.trim();
      if (value && value.length < 10) {
        showFieldError(descField, "Description must be at least 10 characters");
      } else {
        clearFieldError(descField);
      }
    });
  }
}

const reuseLendBtn = document.getElementById("reuse-lend-btn");
if (reuseLendBtn) {
  reuseLendBtn.addEventListener("click", () => {
    setTimeout(setupFormValidation, 100);
  });
}

const lendForm = document.getElementById("lend-form");
if (lendForm) {
    lendForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        const itemInput = document.getElementById("item-input");
        const productname = (itemInput && itemInput.value.trim()) || "";
        const description = (document.getElementById("lend-description")?.value ?? "").trim();
        const name = (document.getElementById("lend-name")?.value ?? "").trim();
        const email = (document.getElementById("lend-email")?.value ?? "").trim();
        const phonenum = (document.getElementById("lend-phone")?.value ?? "").trim();

        let isValid = true;
        const emailField = document.getElementById("lend-email");
        const phoneField = document.getElementById("lend-phone");
        const nameField = document.getElementById("lend-name");
        const descField = document.getElementById("lend-description");

        if (!productname) {
          alert("Please enter an item name first");
          return;
        }

        if (description.length < 10) {
          showFieldError(descField, "Description must be at least 10 characters");
          isValid = false;
        }

        if (name.length < 2) {
          showFieldError(nameField, "Name must be at least 2 characters");
          isValid = false;
        }

        if (!validateEmail(email)) {
          showFieldError(emailField, "Please enter a valid email");
          isValid = false;
        }

        if (!validatePhone(phonenum)) {
          showFieldError(phoneField, "Please enter a valid phone number");
          isValid = false;
        }

        if (!isValid) return;

        try {
            const result = await postItem(productname, description, name, email, phonenum);
            console.log("Lend submission result:", result);
            alert("Item successfully listed for lending!");
            lendForm.reset();
        } catch (err) {
            console.error("Lend form submission failed:", err);
            alert("Failed to submit. Please try again.");
        }
    });
}

