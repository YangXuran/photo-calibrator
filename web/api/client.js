async function expectJson(response) {
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function fetchCapabilities(backend) {
  const suffix = backend ? `?backend=${encodeURIComponent(backend)}` : "";
  const response = await fetch(`/api/capabilities${suffix}`);
  return expectJson(response);
}

export async function fetchAcceleratorBenchmark(backend) {
  const encodedBackend = encodeURIComponent(backend || "auto");
  const response = await fetch(`/api/accelerator-benchmark?backend=${encodedBackend}&image_side=128&lut_size=9&iterations=2`);
  return expectJson(response);
}

export async function postCalibrationSession(body) {
  const response = await fetch("/api/calibrate-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return expectJson(response);
}

export async function postCalibration(body) {
  const response = await fetch("/api/calibrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return expectJson(response);
}
