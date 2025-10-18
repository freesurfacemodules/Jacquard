@inline function softclipPade(x: f32): f32 {
  let clamped: f32 = x;
  if (clamped < -3.0) clamped = -3.0;
  if (clamped > 3.0) clamped = 3.0;
  const x2: f32 = clamped * clamped;
  return clamped * (27.0 + x2) / (27.0 + 9.0 * x2);
}

@inline function dbToGain(db: f32): f32 {
  return Mathf.pow(10.0, db * 0.05);
}

export function softclipSample(input: f32, inDb: f32, outDb: f32): f32 {
  const inGain: f32 = dbToGain(inDb);
  const outGain: f32 = dbToGain(outDb);
  const driven: f32 = input * inGain;
  const clipped: f32 = softclipPade(driven);
  return clipped * outGain;
}
