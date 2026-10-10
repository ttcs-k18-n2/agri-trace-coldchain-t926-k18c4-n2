/**
 * CSV Parser and Validator Utility
 * Hỗ trợ phân tích dữ liệu CSV dạng chuẩn RFC 4180 (hỗ trợ dấu phẩy trong ngoặc kép, newline, BOM)
 */

/**
 * Phân tích chuỗi CSV thô thành danh sách các dòng và cột
 * @param {string} text Nội dung tệp CSV
 * @returns {string[][]} Mảng 2 chiều đại diện cho các hàng và cột
 */
function parseCsv(text) {
  if (typeof text !== "string") {
    return [];
  }

  // Loại bỏ BOM nếu có (\uFEFF)
  let cleanText = text.replace(/^\uFEFF/, "");
  // Chuẩn hóa xuống dòng CRLF / CR thành LF
  cleanText = cleanText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const rows = [];
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;

  while (i < cleanText.length) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Thoát dấu ngoặc kép "" -> "
          currentField += '"';
          i += 2;
          continue;
        } else {
          // Kết thúc chuỗi ngoặc kép
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = "";
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  // Đẩy trường cuối cùng và dòng cuối cùng nếu còn
  if (currentField !== "" || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  // Loại bỏ các dòng hoàn toàn trống ở cuối
  while (rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    const isAllEmpty = lastRow.every((val) => !val || val.trim() === "");
    if (isAllEmpty) {
      rows.pop();
    } else {
      break;
    }
  }

  return rows;
}

/**
 * Kiểm tra và nhập danh mục Sản phẩm từ CSV
 * Cột mẫu: name, unit
 * Quy tắc:
 * - Dòng 1 là tiêu đề (header): phải chứa 'name' (hoặc 'Tên', 'tên sản phẩm') và 'unit' (hoặc 'Đơn vị')
 * - name: không rỗng, không trùng nhau trong file và không trùng trong hệ thống
 * - unit: thuộc ['kg', 'tan', 'thung']
 * @param {string} csvText 
 * @param {object} context { existingNamesLower: Set<string> }
 * @returns {{ valid: boolean, errors: Array<{row: number, column: string, message: string}>, rows: Array<{name: string, unit: string}> }}
 */
function validateProductsCsv(csvText, existingNamesLower = new Set()) {
  const rawRows = parseCsv(csvText);
  const errors = [];

  if (rawRows.length === 0) {
    errors.push({
      row: 1,
      column: "file",
      message: "Tệp CSV trống hoặc không có dữ liệu.",
    });
    return { valid: false, errors, rows: [] };
  }

  const headerRow = rawRows[0].map((h) => (h || "").trim().toLowerCase());
  
  // Xác định vị trí cột
  let nameColIdx = headerRow.findIndex((h) => ["name", "ten", "tên", "tên sản phẩm", "ten san pham"].includes(h));
  let unitColIdx = headerRow.findIndex((h) => ["unit", "don vi", "đơn vị", "don_vi", "đơn vị tính"].includes(h));

  // Nếu không trùng khớp tiêu chuẩn, giả định vị trí cột mặc định nếu có đúng 2 cột
  if (nameColIdx === -1 && unitColIdx === -1 && headerRow.length >= 2) {
    nameColIdx = 0;
    unitColIdx = 1;
  } else {
    if (nameColIdx === -1) {
      errors.push({
        row: 1,
        column: "name",
        message: "Không tìm thấy cột tiêu đề 'Tên sản phẩm' (name).",
      });
    }
    if (unitColIdx === -1) {
      errors.push({
        row: 1,
        column: "unit",
        message: "Không tìm thấy cột tiêu đề 'Đơn vị tính' (unit).",
      });
    }
    if (errors.length > 0) {
      return { valid: false, errors, rows: [] };
    }
  }

  const dataRows = rawRows.slice(1);
  if (dataRows.length === 0) {
    errors.push({
      row: 1,
      column: "data",
      message: "Tệp CSV chỉ có dòng tiêu đề, không có dữ liệu sản phẩm.",
    });
    return { valid: false, errors, rows: [] };
  }

  const fileNamesSet = new Set();
  const validUnits = ["kg", "tan", "thung"];
  const parsedItems = [];

  dataRows.forEach((row, index) => {
    const rowNum = index + 2; // 1-based index (dòng 1 là header)

    // Bỏ qua dòng trống hoàn toàn giữa các dòng
    if (row.length === 0 || (row.length === 1 && !row[0].trim())) {
      return;
    }

    const rawName = (row[nameColIdx] || "").trim();
    const rawUnit = (row[unitColIdx] || "").trim().toLowerCase();

    // 1. Kiểm tra Tên sản phẩm
    if (!rawName) {
      errors.push({
        row: rowNum,
        column: "name",
        message: "Tên sản phẩm không được để trống.",
      });
    } else {
      const lowerName = rawName.toLowerCase();
      if (fileNamesSet.has(lowerName)) {
        errors.push({
          row: rowNum,
          column: "name",
          message: `Tên sản phẩm '${rawName}' bị trùng lặp trong tệp CSV.`,
        });
      } else if (existingNamesLower.has(lowerName)) {
        errors.push({
          row: rowNum,
          column: "name",
          message: `Sản phẩm '${rawName}' đã tồn tại trong hệ thống.`,
        });
      } else {
        fileNamesSet.add(lowerName);
      }
    }

    // 2. Kiểm tra Đơn vị tính
    if (!rawUnit) {
      errors.push({
        row: rowNum,
        column: "unit",
        message: "Đơn vị tính không được để trống.",
      });
    } else if (!validUnits.includes(rawUnit)) {
      errors.push({
        row: rowNum,
        column: "unit",
        message: `Đơn vị tính '${rawUnit}' không hợp lệ. Chỉ chấp nhận: kg, tan, thung.`,
      });
    }

    parsedItems.push({
      row: rowNum,
      name: rawName,
      unit: rawUnit,
    });
  });

  return {
    valid: errors.length === 0,
    errors,
    rows: errors.length === 0 ? parsedItems : [],
  };
}

/**
 * Kiểm tra và nhập danh mục Thửa đất từ CSV
 * Cột mẫu: name, area, coordinates
 * Quy tắc:
 * - name: không để trống, không trùng lặp trong tổ chức
 * - area: số > 0
 * - coordinates: chuỗi tọa độ (tùy chọn)
 * @param {string} csvText 
 * @param {object} context { existingFarmNamesLower: Set<string> }
 * @returns {{ valid: boolean, errors: Array<{row: number, column: string, message: string}>, rows: Array<{name: string, area: number, coordinates: string}> }}
 */
function validateFarmsCsv(csvText, existingFarmNamesLower = new Set()) {
  const rawRows = parseCsv(csvText);
  const errors = [];

  if (rawRows.length === 0) {
    errors.push({
      row: 1,
      column: "file",
      message: "Tệp CSV trống hoặc không có dữ liệu.",
    });
    return { valid: false, errors, rows: [] };
  }

  const headerRow = rawRows[0].map((h) => (h || "").trim().toLowerCase());

  let nameColIdx = headerRow.findIndex((h) => ["name", "ten", "tên", "tên thửa", "ten thua"].includes(h));
  let areaColIdx = headerRow.findIndex((h) => ["area", "dien tich", "diện tích", "dien_tich"].includes(h));
  let coordColIdx = headerRow.findIndex((h) => ["coordinates", "toa do", "tọa độ", "toa_do"].includes(h));

  if (nameColIdx === -1 && areaColIdx === -1 && headerRow.length >= 2) {
    nameColIdx = 0;
    areaColIdx = 1;
    coordColIdx = headerRow.length > 2 ? 2 : -1;
  } else {
    if (nameColIdx === -1) {
      errors.push({
        row: 1,
        column: "name",
        message: "Không tìm thấy cột tiêu đề 'Tên thửa đất' (name).",
      });
    }
    if (areaColIdx === -1) {
      errors.push({
        row: 1,
        column: "area",
        message: "Không tìm thấy cột tiêu đề 'Diện tích' (area).",
      });
    }
    if (errors.length > 0) {
      return { valid: false, errors, rows: [] };
    }
  }

  const dataRows = rawRows.slice(1);
  if (dataRows.length === 0) {
    errors.push({
      row: 1,
      column: "data",
      message: "Tệp CSV chỉ có dòng tiêu đề, không có dữ liệu thửa đất.",
    });
    return { valid: false, errors, rows: [] };
  }

  const fileNamesSet = new Set();
  const parsedItems = [];

  dataRows.forEach((row, index) => {
    const rowNum = index + 2;

    if (row.length === 0 || (row.length === 1 && !row[0].trim())) {
      return;
    }

    const rawName = (row[nameColIdx] || "").trim();
    const rawAreaStr = (row[areaColIdx] || "").trim();
    const rawCoord = coordColIdx !== -1 && row[coordColIdx] ? row[coordColIdx].trim() : "";

    // 1. Kiểm tra Tên thửa
    if (!rawName) {
      errors.push({
        row: rowNum,
        column: "name",
        message: "Tên thửa đất không được để trống.",
      });
    } else {
      const lowerName = rawName.toLowerCase();
      if (fileNamesSet.has(lowerName)) {
        errors.push({
          row: rowNum,
          column: "name",
          message: `Tên thửa đất '${rawName}' bị trùng lặp trong tệp CSV.`,
        });
      } else if (existingFarmNamesLower.has(lowerName)) {
        errors.push({
          row: rowNum,
          column: "name",
          message: `Thửa đất '${rawName}' đã tồn tại trong tổ chức của bạn.`,
        });
      } else {
        fileNamesSet.add(lowerName);
      }
    }

    // 2. Kiểm tra Diện tích
    const areaNum = parseFloat(rawAreaStr);
    if (!rawAreaStr) {
      errors.push({
        row: rowNum,
        column: "area",
        message: "Diện tích không được để trống.",
      });
    } else if (isNaN(areaNum) || areaNum <= 0) {
      errors.push({
        row: rowNum,
        column: "area",
        message: `Diện tích '${rawAreaStr}' không hợp lệ. Phải là số dương lớn hơn 0 (ha).`,
      });
    }

    parsedItems.push({
      row: rowNum,
      name: rawName,
      area: areaNum,
      coordinates: rawCoord,
    });
  });

  return {
    valid: errors.length === 0,
    errors,
    rows: errors.length === 0 ? parsedItems : [],
  };
}

module.exports = {
  parseCsv,
  validateProductsCsv,
  validateFarmsCsv,
};
