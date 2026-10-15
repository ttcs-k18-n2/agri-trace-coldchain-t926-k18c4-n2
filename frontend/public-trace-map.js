/**
 * Public Trace Map Component (Story S-60 / N2-257)
 * Tích hợp MapLibre GL JS và bản đồ OpenFreeMap không cần API Key
 * Hỗ trợ hiển thị hành trình nguồn gốc, lô một nguồn và lô gộp nhiều nguồn, bảo vệ quyền riêng tư
 */

(function (global) {
  "use strict";

  const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(isoStr) {
    if (!isoStr) return "Chưa xác định";
    try {
      const d = new Date(isoStr);
      if (Number.isNaN(d.getTime())) return isoStr;
      return d.toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoStr;
    }
  }

  function getStepCategory(type) {
    if (type === "farm") return "farm";
    if (type === "store" || type === "distribution_center") return "store";
    return "storage";
  }

  class PublicTraceMap {
    constructor(options = {}) {
      this.containerId = options.containerId || "trace-map";
      this.timelineContainerId = options.timelineContainerId || "trace-timeline";
      this.apiUrl = options.apiUrl || "/api/public/lots";
      this.map = null;
      this.markers = [];
      this.mapData = null;
    }

    /**
     * Tải dữ liệu từ API S-60 và kết xuất bản đồ
     */
    async loadAndRender(lotCode) {
      if (!lotCode) {
        this.renderError("Vui lòng cung cấp mã lô nông sản hợp lệ để truy xuất bản đồ.");
        return null;
      }

      this.renderLoading();

      try {
        const response = await fetch(`${this.apiUrl}/${encodeURIComponent(lotCode)}/map`);
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData.message || (response.status === 404
            ? "Không tìm thấy thông tin lô hàng trên hệ thống truy xuất công khai."
            : "Lỗi kết nối máy chủ khi truy xuất bản đồ.");
          this.renderError(errMsg, response.status);
          return null;
        }

        const data = await response.json();
        this.mapData = data;
        this.render(data);
        return data;
      } catch (err) {
        this.renderError("Không thể kết nối đến máy chủ truy xuất nguồn gốc. Vui lòng kiểm tra lại đường truyền internet.");
        return null;
      }
    }

    /**
     * Kết xuất bản đồ với đối tượng dữ liệu đã có
     */
    render(data) {
      this.mapData = data;
      const container = document.getElementById(this.containerId);
      if (!container) return;

      container.innerHTML = "";

      // Kiểm tra xem MapLibre GL JS có sẵn sàng không
      if (typeof global.maplibregl === "undefined") {
        this.renderFallbackView(data, "Thư viện bản đồ số MapLibre chưa được tải. Hiển thị hành trình dạng mốc sự kiện trực quan.");
        this.renderTimeline(data);
        return;
      }

      // Lọc các điểm có tọa độ hợp lệ
      const locatedStops = (data.journey || []).filter((s) => s.hasCoordinates && s.coordinates);

      if (locatedStops.length === 0) {
        this.renderFallbackView(data, "Lô hàng này có lịch sử ghi nhận bằng văn bản nhưng chưa có tọa độ số hóa. Bạn có thể xem toàn bộ hành trình bên dưới.");
        this.renderTimeline(data);
        return;
      }

      try {
        // Tạo container bản đồ và overlay ghi chú
        const mapDiv = document.createElement("div");
        mapDiv.className = "public-trace-map-container";
        container.appendChild(mapDiv);

        // Overlay chú giải
        const legend = document.createElement("div");
        legend.className = "map-legend-overlay";
        legend.innerHTML = `
          <div class="map-legend-item">
            <span class="map-legend-badge farm"></span>
            <span>Vùng trồng đã xác thực</span>
          </div>
          <div class="map-legend-item">
            <span class="map-legend-badge storage"></span>
            <span>Kho lạnh / Trung chuyển</span>
          </div>
          <div class="map-legend-item">
            <span class="map-legend-badge store"></span>
            <span>Điểm phân phối / Bán lẻ</span>
          </div>
        `;
        mapDiv.appendChild(legend);

        // Khởi tạo bản đồ MapLibre
        const initialCenter = [locatedStops[0].coordinates.lng, locatedStops[0].coordinates.lat];
        this.map = new global.maplibregl.Map({
          container: mapDiv,
          style: OPENFREEMAP_STYLE,
          center: initialCenter,
          zoom: 9,
          attributionControl: true,
        });

        // Bổ sung nút điều hướng thu phóng & toàn màn hình
        this.map.addControl(new global.maplibregl.NavigationControl(), "top-right");
        this.map.addControl(new global.maplibregl.FullscreenControl(), "top-right");

        this.map.on("load", () => {
          this.drawRoutes(data.routes || []);
          this.addMarkers(locatedStops);
          this.fitMapBounds(locatedStops);
        });

        this.map.on("error", () => {
          // Khi lỗi tải tiles từ OpenFreeMap, giữ bản đồ và hiển thị thông báo
          console.warn("OpenFreeMap tile server issue detected. Fallback active.");
        });

        // Bổ sung ghi chú quyền riêng tư phía dưới bản đồ
        if (data.summary && data.summary.disclaimer) {
          const disclaimerDiv = document.createElement("div");
          disclaimerDiv.className = "trace-map-disclaimer";
          disclaimerDiv.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <span>${escapeHtml(data.summary.disclaimer)}</span>
          `;
          container.appendChild(disclaimerDiv);
        }

        // Kết xuất timeline chi tiết
        this.renderTimeline(data);
      } catch (err) {
        console.error("Lỗi khởi tạo bản đồ MapLibre:", err);
        this.renderFallbackView(data, "Gặp sự cố khi khởi tạo đồ họa bản đồ. Đang hiển thị hành trình dạng dòng thời gian chi tiết.");
        this.renderTimeline(data);
      }
    }

    /**
     * Vẽ các đường nối hành trình (GeoJSON routes)
     */
    drawRoutes(routes) {
      if (!this.map || !routes || routes.length === 0) return;

      const features = routes.map((r, idx) => ({
        type: "Feature",
        id: `route-${idx}`,
        geometry: {
          type: "LineString",
          coordinates: r.coordinates,
        },
        properties: {
          fromTitle: r.fromTitle,
          toTitle: r.toTitle,
        },
      }));

      const geojsonData = {
        type: "FeatureCollection",
        features,
      };

      if (this.map.getSource("trace-routes")) {
        this.map.getSource("trace-routes").setData(geojsonData);
      } else {
        this.map.addSource("trace-routes", {
          type: "geojson",
          data: geojsonData,
        });

        // Đường viền ngoài phát sáng nhẹ
        this.map.addLayer({
          id: "trace-routes-casing",
          type: "line",
          source: "trace-routes",
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": "#ffffff",
            "line-width": 6,
            "line-opacity": 0.85,
          },
        });

        // Tuyến đường chuỗi lạnh chính
        this.map.addLayer({
          id: "trace-routes-line",
          type: "line",
          source: "trace-routes",
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": "#0284c7",
            "line-width": 3.5,
            "line-dasharray": [2, 1.5],
          },
        });
      }
    }

    /**
     * Đặt marker đánh số và popup cho từng điểm dừng
     */
    addMarkers(stops) {
      this.markers = [];
      const total = stops.length;

      stops.forEach((stop, index) => {
        const isLast = index === total - 1 && total > 1;
        const category = getStepCategory(stop.type);

        // Tạo phần tử DOM cho marker
        const el = document.createElement("div");
        el.className = "trace-custom-marker";
        el.setAttribute("data-step", stop.step);

        if (isLast) {
          const pulse = document.createElement("div");
          pulse.className = "trace-marker-pulse";
          el.appendChild(pulse);
        }

        const pin = document.createElement("div");
        pin.className = `trace-marker-pin ${category}`;

        const num = document.createElement("div");
        num.className = "trace-marker-number";
        num.textContent = stop.step;
        pin.appendChild(num);
        el.appendChild(pin);

        // Tạo Popup tương tác
        const popupContent = `
          <div class="trace-popup-header">
            <span class="trace-popup-step-badge ${category}">Bước ${stop.step}: ${escapeHtml(stop.typeLabel)}</span>
          </div>
          <h4 class="trace-popup-title">${escapeHtml(stop.title)}</h4>
          <div class="trace-popup-org">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-3M9 9h1M9 13h1M9 17h1M15 13h1M15 17h1"/>
            </svg>
            <span>${escapeHtml(stop.organizationName || "Tổ chức chuỗi cung ứng")}</span>
          </div>
          <div class="trace-popup-address">${escapeHtml(stop.address || "Khu vực địa lý đã xác thực")}</div>
          <div style="font-size: 11px; color: #64748b; margin-bottom: 6px;">
            Thời gian: <strong>${formatDate(stop.occurredAt)}</strong>
          </div>
          <span class="trace-popup-verified">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Tọa độ đã xác minh
          </span>
        `;

        const popup = new global.maplibregl.Popup({
          offset: 22,
          closeButton: true,
          closeOnClick: false,
        }).setHTML(popupContent);

        const marker = new global.maplibregl.Marker({ element: el })
          .setLngLat([stop.coordinates.lng, stop.coordinates.lat])
          .setPopup(popup)
          .addTo(this.map);

        el.addEventListener("click", () => {
          this.highlightTimelineStep(stop.step);
        });

        this.markers.push({ step: stop.step, marker, popup, coords: stop.coordinates });
      });
    }

    /**
     * Tự động điều chỉnh khung nhìn bản đồ bao trọn tất cả các điểm
     */
    fitMapBounds(stops) {
      if (!this.map || stops.length === 0) return;

      if (stops.length === 1) {
        this.map.setCenter([stops[0].coordinates.lng, stops[0].coordinates.lat]);
        this.map.setZoom(12);
        return;
      }

      const bounds = new global.maplibregl.LngLatBounds();
      stops.forEach((s) => {
        bounds.extend([s.coordinates.lng, s.coordinates.lat]);
      });

      this.map.fitBounds(bounds, {
        padding: { top: 60, bottom: 60, left: 60, right: 60 },
        maxZoom: 13,
        duration: 800,
      });
    }

    /**
     * Bay đến điểm marker khi bấm vào timeline card
     */
    flyToStep(stepNumber) {
      const target = this.markers.find((m) => m.step === stepNumber);
      if (target && this.map) {
        this.map.flyTo({
          center: [target.coords.lng, target.coords.lat],
          zoom: 13,
          duration: 1000,
        });
        target.marker.togglePopup();
      }
      this.highlightTimelineStep(stepNumber);
    }

    highlightTimelineStep(stepNumber) {
      const cards = document.querySelectorAll(".trace-timeline-step-card");
      cards.forEach((c) => {
        if (Number(c.getAttribute("data-step")) === stepNumber) {
          c.classList.add("active-marker");
          c.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else {
          c.classList.remove("active-marker");
        }
      });
    }

    /**
     * Hiển thị danh sách Timeline các bước hành trình
     */
    renderTimeline(data) {
      const timelineEl = document.getElementById(this.timelineContainerId);
      if (!timelineEl) return;

      const journey = data.journey || [];
      if (journey.length === 0) {
        timelineEl.innerHTML = `<div class="trace-map-fallback"><p>Chưa có dữ liệu hành trình cho lô hàng này.</p></div>`;
        return;
      }

      let html = `<div class="trace-timeline-container">`;

      journey.forEach((step) => {
        const cat = step.type === "transit" ? "transit" : getStepCategory(step.type);
        const hasCoords = step.hasCoordinates && step.coordinates;

        html += `
          <div class="trace-timeline-step-card" data-step="${step.step}" ${hasCoords ? `onclick="window.__traceMapInstance && window.__traceMapInstance.flyToStep(${step.step})"` : ""} style="${hasCoords ? "cursor: pointer;" : ""}">
            <div class="trace-timeline-step-icon ${cat}">
              ${step.step}
            </div>
            <div class="trace-timeline-step-content">
              <div class="trace-timeline-header-row">
                <h4 class="trace-timeline-title">${escapeHtml(step.title)}</h4>
                <span class="trace-timeline-time">${formatDate(step.occurredAt)}</span>
              </div>
              <div class="trace-timeline-org">${escapeHtml(step.organizationName || "")} • <em>${escapeHtml(step.typeLabel)}</em></div>
              <div class="trace-timeline-address">${escapeHtml(step.address || "Khu vực địa lý")}</div>
              ${step.description ? `<div class="trace-timeline-desc">${escapeHtml(step.description)}</div>` : ""}
              <div class="trace-timeline-badges">
                ${hasCoords
                  ? `<span class="trace-badge trace-badge-verified">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      Vị trí đã xác minh
                    </span>`
                  : `<span class="trace-badge trace-badge-unverified">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="12" x2="12" y2="12"></line></svg>
                      Mốc thông tin văn bản
                    </span>`}
              </div>
            </div>
          </div>
        `;
      });

      html += `</div>`;
      timelineEl.innerHTML = html;
    }

    /**
     * Giao diện fallback khi bản đồ hoặc API không khả dụng
     */
    renderFallbackView(data, noticeText) {
      const container = document.getElementById(this.containerId);
      if (!container) return;

      container.innerHTML = `
        <div class="trace-map-fallback">
          <div class="trace-map-fallback-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon>
              <line x1="8" y1="2" x2="8" y2="18"></line>
              <line x1="16" y1="6" x2="16" y2="22"></line>
            </svg>
          </div>
          <h4 class="trace-map-fallback-title">Hành trình nông sản minh bạch</h4>
          <p class="trace-map-fallback-desc">${escapeHtml(noticeText)}</p>
        </div>
      `;
    }

    renderLoading() {
      const container = document.getElementById(this.containerId);
      if (container) {
        container.innerHTML = `
          <div class="trace-map-fallback">
            <div style="width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #0284c7; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
            <p style="font-size: 14px; color: #64748b; margin-top: 10px;">Đang tải dữ liệu bản đồ hành trình nông sản...</p>
          </div>
          <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
        `;
      }
    }

    renderError(message) {
      const container = document.getElementById(this.containerId);
      if (container) {
        container.innerHTML = `
          <div class="trace-map-fallback" style="background: #fff1f2; border: 1px solid #fecdd3;">
            <div class="trace-map-fallback-icon" style="background: #ffe4e6; color: #e11d48;">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <h4 class="trace-map-fallback-title" style="color: #9f1239;">Thông báo truy xuất</h4>
            <p class="trace-map-fallback-desc" style="color: #be123c;">${escapeHtml(message)}</p>
          </div>
        `;
      }
      const timelineEl = document.getElementById(this.timelineContainerId);
      if (timelineEl) {
        timelineEl.innerHTML = "";
      }
    }
  }

  // Xuất PublicTraceMap vào global
  global.PublicTraceMap = PublicTraceMap;
})(typeof window !== "undefined" ? window : globalThis);
