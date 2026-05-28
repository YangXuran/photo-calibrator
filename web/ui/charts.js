function clearCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#10120f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawGrid(ctx, x0, y0, w, h) {
  ctx.strokeStyle = "#2f352d";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = y0 + (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#596054";
  ctx.strokeRect(x0, y0, w, h);
}

function drawRgbHistogram(canvas, hist) {
  const ctx = canvas.getContext("2d");
  clearCanvas(canvas);
  const pad = 22;
  const w = canvas.width - pad * 2;
  const h = canvas.height - pad * 2;
  drawGrid(ctx, pad, pad, w, h);
  const colors = { r: "#e96d5c", g: "#6fd1b5", b: "#6ea7e8" };
  const channels = hist.channels || hist;
  for (const key of ["r", "g", "b"]) {
    const channel = channels[key] || {};
    const values = channel.normalized || channel || [];
    ctx.strokeStyle = colors[key];
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = pad + (index / Math.max(values.length - 1, 1)) * w;
      const y = pad + h - value * h;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

function drawLabVector(canvas, vectors) {
  const ctx = canvas.getContext("2d");
  clearCanvas(canvas);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = Math.min(canvas.width, canvas.height) * 0.38;
  const maxAbs = Math.max(8, ...vectors.flatMap((v) => [Math.abs(v.a), Math.abs(v.b)]));
  ctx.strokeStyle = "#596054";
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();
  ctx.strokeStyle = "#3b4238";
  for (const r of [0.33, 0.66, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const colors = ["#f0c15f", "#6fd1b5", "#f08aac"];
  vectors.forEach((v, index) => {
    const x = cx + (v.a / maxAbs) * radius;
    const y = cy - (v.b / maxAbs) * radius;
    ctx.strokeStyle = colors[index] || "#fff";
    ctx.fillStyle = colors[index] || "#fff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(v.name, x + 7, y - 5);
  });
}

function drawStrengthChart(canvas, strengths) {
  const ctx = canvas.getContext("2d");
  clearCanvas(canvas);
  const maxValue = Math.max(1, ...strengths.map((s) => s.value));
  const colors = ["#f0c15f", "#6fd1b5"];
  strengths.forEach((item, index) => {
    const x = 52 + index * 108;
    const barH = (item.value / maxValue) * 72;
    ctx.fillStyle = colors[index];
    ctx.fillRect(x, 98 - barH, 52, barH);
    ctx.fillStyle = "#f2f0ea";
    ctx.fillText(item.value.toFixed(1), x + 8, 88 - barH);
    ctx.fillStyle = "#b7b6ad";
    ctx.fillText(item.name, x + 4, 116);
  });
}

function drawZoneChart(canvas, zones) {
  const ctx = canvas.getContext("2d");
  clearCanvas(canvas);
  const maxAbs = Math.max(3, ...zones.flatMap((z) => [Math.abs(z.a), Math.abs(z.b)]));
  const zero = canvas.height / 2;
  ctx.strokeStyle = "#596054";
  ctx.beginPath();
  ctx.moveTo(20, zero);
  ctx.lineTo(canvas.width - 12, zero);
  ctx.stroke();
  zones.forEach((zone, index) => {
    const x = 42 + index * 84;
    const ah = (zone.a / maxAbs) * 48;
    const bh = (zone.b / maxAbs) * 48;
    ctx.fillStyle = "#e96d5c";
    ctx.fillRect(x, zero - ah, 18, ah);
    ctx.fillStyle = "#6ea7e8";
    ctx.fillRect(x + 24, zero - bh, 18, bh);
    ctx.fillStyle = "#b7b6ad";
    ctx.fillText(zone.name, x - 4, 138);
  });
}

export function renderCharts(els, charts) {
  if (!charts) return;
  drawRgbHistogram(els.rgbHistogram, charts.rgb_histogram || {});
  drawLabVector(els.labVector, charts.lab_vectors || []);
  drawStrengthChart(els.strengthChart, charts.strengths || []);
  drawZoneChart(els.zoneChart, charts.zones || []);
}
