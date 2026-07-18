use base64::Engine;
use image::{DynamicImage, GenericImageView, ImageFormat};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

struct AppState {
    current_image: Mutex<Option<DynamicImage>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageInfo {
    width: u32,
    height: u32,
    file_size: u64,
    channels: u8,
}

#[derive(Serialize)]
struct LoadResult {
    info: ImageInfo,
    data_url: String,
}

#[derive(Deserialize)]
struct GradeOperation {
    #[serde(rename = "type")]
    operation_type: String,
    enabled: bool,
    values: HashMap<String, f32>,
    #[serde(rename = "lutPath")]
    lut_path: Option<String>,
    masks: Option<Vec<MaskReference>>,
    mask: Option<MaskReference>,
}

struct Lut3d {
    size: usize,
    domain_min: [f32; 3],
    domain_max: [f32; 3],
    data: Vec<[f32; 3]>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MaskReference {
    layer_id: Option<String>,
    mode: String,
}

#[derive(Deserialize)]
struct MaskPoint {
    x: f32,
    y: f32,
}

#[derive(Deserialize)]
struct MaskLayer {
    id: String,
    #[allow(dead_code)]
    name: String,
    #[allow(dead_code)]
    #[serde(rename = "type")]
    layer_type: String,
    shape: String,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    feather: f32,
    opacity: f32,
    angle: Option<f32>,
    points: Option<Vec<MaskPoint>>,
}

fn encode_png(img: &DynamicImage) -> Result<String, String> {
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
    Ok(format!("data:image/png;base64,{}", encoded))
}

fn image_format_from_path(path: &str) -> Result<ImageFormat, String> {
    let extension = Path::new(path)
        .extension()
        .and_then(|item| item.to_str())
        .unwrap_or("")
        .to_lowercase();
    match extension.as_str() {
        "png" => Ok(ImageFormat::Png),
        "jpg" | "jpeg" => Ok(ImageFormat::Jpeg),
        "tif" | "tiff" => Ok(ImageFormat::Tiff),
        _ => Err("Unsupported export format. Use .png, .jpg, .jpeg, .tif, or .tiff".to_string()),
    }
}

fn preview_image(img: DynamicImage, max_dimension: Option<u32>) -> DynamicImage {
    let Some(max_dimension) = max_dimension else {
        return img;
    };
    if max_dimension == 0 {
        return img;
    }

    let (width, height) = img.dimensions();
    let longest = width.max(height);
    if longest <= max_dimension {
        return img;
    }

    let scale = max_dimension as f32 / longest as f32;
    let preview_width = ((width as f32 * scale).round() as u32).max(1);
    let preview_height = ((height as f32 * scale).round() as u32).max(1);
    img.resize(
        preview_width,
        preview_height,
        image::imageops::FilterType::Triangle,
    )
}

fn blend_channel(original: u8, adjusted: f32, blend: f32) -> u8 {
    let blended = original as f32 + (adjusted - original as f32) * blend;
    blended.round().clamp(0.0, 255.0) as u8
}

fn rgb_to_hsv(r: u8, g: u8, b: u8) -> (f32, f32, f32) {
    let r = r as f32 / 255.0;
    let g = g as f32 / 255.0;
    let b = b as f32 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    let hue = if delta <= f32::EPSILON {
        0.0
    } else if max == r {
        ((g - b) / delta).rem_euclid(6.0) / 6.0
    } else if max == g {
        ((b - r) / delta + 2.0) / 6.0
    } else {
        ((r - g) / delta + 4.0) / 6.0
    };
    let saturation = if max <= f32::EPSILON {
        0.0
    } else {
        delta / max
    };
    (hue, saturation, max)
}

fn hsv_to_rgb(hue: f32, saturation: f32, value: f32) -> (f32, f32, f32) {
    let chroma = value * saturation;
    let hue_sector = (hue.rem_euclid(1.0)) * 6.0;
    let x = chroma * (1.0 - (hue_sector.rem_euclid(2.0) - 1.0).abs());
    let (r1, g1, b1) = if hue_sector < 1.0 {
        (chroma, x, 0.0)
    } else if hue_sector < 2.0 {
        (x, chroma, 0.0)
    } else if hue_sector < 3.0 {
        (0.0, chroma, x)
    } else if hue_sector < 4.0 {
        (0.0, x, chroma)
    } else if hue_sector < 5.0 {
        (x, 0.0, chroma)
    } else {
        (chroma, 0.0, x)
    };
    let m = value - chroma;
    ((r1 + m) * 255.0, (g1 + m) * 255.0, (b1 + m) * 255.0)
}

fn hue_distance_degrees(a: f32, b: f32) -> f32 {
    let delta = (a - b).abs().rem_euclid(360.0);
    delta.min(360.0 - delta)
}

fn hue_range_weight(hue_degrees: f32, center: f32, range: f32, feather: f32) -> f32 {
    let half_range = (range / 2.0).clamp(0.5, 180.0);
    let feather = feather.clamp(0.0, 180.0);
    let distance = hue_distance_degrees(hue_degrees, center.rem_euclid(360.0));
    if distance <= half_range {
        return 1.0;
    }
    if feather <= 0.0 || distance >= half_range + feather {
        return 0.0;
    }
    1.0 - ((distance - half_range) / feather).clamp(0.0, 1.0)
}

fn parse_three_floats(items: &[&str]) -> Option<[f32; 3]> {
    if items.len() < 3 {
        return None;
    }
    Some([
        items[0].parse().ok()?,
        items[1].parse().ok()?,
        items[2].parse().ok()?,
    ])
}

fn parse_cube_lut(path: &str) -> Result<Lut3d, String> {
    let contents =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read LUT: {}", e))?;
    let mut size: Option<usize> = None;
    let mut domain_min = [0.0, 0.0, 0.0];
    let mut domain_max = [1.0, 1.0, 1.0];
    let mut data: Vec<[f32; 3]> = Vec::new();

    for raw_line in contents.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }
        match parts[0] {
            "TITLE" | "LUT_1D_SIZE" => {}
            "LUT_3D_SIZE" => {
                size = parts.get(1).and_then(|value| value.parse::<usize>().ok());
            }
            "DOMAIN_MIN" => {
                if let Some(values) = parse_three_floats(&parts[1..]) {
                    domain_min = values;
                }
            }
            "DOMAIN_MAX" => {
                if let Some(values) = parse_three_floats(&parts[1..]) {
                    domain_max = values;
                }
            }
            _ => {
                if let Some(values) = parse_three_floats(&parts) {
                    data.push([
                        values[0].clamp(0.0, 1.0),
                        values[1].clamp(0.0, 1.0),
                        values[2].clamp(0.0, 1.0),
                    ]);
                }
            }
        }
    }

    let size = size.ok_or("LUT_3D_SIZE missing from .cube file")?;
    let expected = size * size * size;
    if data.len() < expected {
        return Err(format!(
            "LUT data is incomplete: expected {} rows, found {}",
            expected,
            data.len()
        ));
    }
    data.truncate(expected);
    Ok(Lut3d {
        size,
        domain_min,
        domain_max,
        data,
    })
}

fn lerp(a: f32, b: f32, amount: f32) -> f32 {
    a + (b - a) * amount
}

fn lut_index(size: usize, r: usize, g: usize, b: usize) -> usize {
    b * size * size + g * size + r
}

fn sample_lut(lut: &Lut3d, r: u8, g: u8, b: u8) -> [f32; 3] {
    let normalize = |value: u8, channel: usize| {
        let input = value as f32 / 255.0;
        let min = lut.domain_min[channel];
        let max = lut.domain_max[channel];
        ((input - min) / (max - min).max(0.0001)).clamp(0.0, 1.0)
    };
    let rf = normalize(r, 0) * (lut.size - 1) as f32;
    let gf = normalize(g, 1) * (lut.size - 1) as f32;
    let bf = normalize(b, 2) * (lut.size - 1) as f32;
    let r0 = rf.floor() as usize;
    let g0 = gf.floor() as usize;
    let b0 = bf.floor() as usize;
    let r1 = (r0 + 1).min(lut.size - 1);
    let g1 = (g0 + 1).min(lut.size - 1);
    let b1 = (b0 + 1).min(lut.size - 1);
    let tr = rf - r0 as f32;
    let tg = gf - g0 as f32;
    let tb = bf - b0 as f32;

    let sample = |ri: usize, gi: usize, bi: usize| lut.data[lut_index(lut.size, ri, gi, bi)];
    let c000 = sample(r0, g0, b0);
    let c100 = sample(r1, g0, b0);
    let c010 = sample(r0, g1, b0);
    let c110 = sample(r1, g1, b0);
    let c001 = sample(r0, g0, b1);
    let c101 = sample(r1, g0, b1);
    let c011 = sample(r0, g1, b1);
    let c111 = sample(r1, g1, b1);

    let mut out = [0.0, 0.0, 0.0];
    for channel in 0..3 {
        let c00 = lerp(c000[channel], c100[channel], tr);
        let c10 = lerp(c010[channel], c110[channel], tr);
        let c01 = lerp(c001[channel], c101[channel], tr);
        let c11 = lerp(c011[channel], c111[channel], tr);
        let c0 = lerp(c00, c10, tg);
        let c1 = lerp(c01, c11, tg);
        out[channel] = lerp(c0, c1, tb) * 255.0;
    }
    out
}

fn curve_points(values: &HashMap<String, f32>, prefix: &str) -> Option<Vec<(f32, f32)>> {
    if !values.contains_key(&format!("{}Point0X", prefix)) {
        return None;
    }

    let mut points = Vec::new();
    for index in 0..8 {
        let x_key = format!("{}Point{}X", prefix, index);
        let y_key = format!("{}Point{}Y", prefix, index);
        let Some(x) = values.get(&x_key) else {
            continue;
        };
        let Some(y) = values.get(&y_key) else {
            continue;
        };
        points.push((x.clamp(0.0, 1.0), y.clamp(0.0, 1.0)));
    }

    if points.len() < 2 {
        return None;
    }

    points.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    points.dedup_by(|a, b| (a.0 - b.0).abs() < 0.001);

    if points.first().map(|point| point.0).unwrap_or(0.0) > 0.0 {
        points.insert(0, (0.0, points.first().map(|point| point.1).unwrap_or(0.0)));
    }
    if points.last().map(|point| point.0).unwrap_or(1.0) < 1.0 {
        points.push((1.0, points.last().map(|point| point.1).unwrap_or(1.0)));
    }

    Some(points)
}

fn build_curve_lut(values: &HashMap<String, f32>, prefix: &str) -> Option<[f32; 256]> {
    let points = curve_points(values, prefix)?;
    let mut lut = [0.0; 256];
    let mut segment = 0;

    for (index, item) in lut.iter_mut().enumerate() {
        let input = index as f32 / 255.0;
        while segment + 1 < points.len() - 1 && input > points[segment + 1].0 {
            segment += 1;
        }
        let (x0, y0) = points[segment];
        let (x1, y1) = points[(segment + 1).min(points.len() - 1)];
        let t = if (x1 - x0).abs() <= f32::EPSILON {
            0.0
        } else {
            ((input - x0) / (x1 - x0)).clamp(0.0, 1.0)
        };
        *item = (y0 + (y1 - y0) * t).clamp(0.0, 1.0) * 255.0;
    }

    Some(lut)
}

fn apply_lut(value: u8, lut: Option<&[f32; 256]>) -> f32 {
    lut.map(|items| items[value as usize])
        .unwrap_or(value as f32)
}

fn operation_blend(operation: &GradeOperation) -> f32 {
    operation
        .values
        .get("Blend")
        .copied()
        .unwrap_or(100.0)
        .clamp(0.0, 100.0)
        / 100.0
}

fn ellipse_alpha(layer: &MaskLayer, x: u32, y: u32, width: u32, height: u32) -> f32 {
    if layer.width <= 0.0 || layer.height <= 0.0 {
        return 0.0;
    }

    let px = (x as f32 + 0.5) / width.max(1) as f32;
    let py = (y as f32 + 0.5) / height.max(1) as f32;
    let rx = (layer.width / 2.0).max(0.001);
    let ry = (layer.height / 2.0).max(0.001);
    let dx = (px - layer.x) / rx;
    let dy = (py - layer.y) / ry;
    let distance = (dx * dx + dy * dy).sqrt();
    let feather = layer.feather.clamp(0.0, 0.95);
    let opacity = layer.opacity.clamp(0.0, 1.0);

    if distance >= 1.0 {
        return 0.0;
    }
    if feather <= 0.0 {
        return opacity;
    }

    let inner = (1.0 - feather).clamp(0.0, 1.0);
    if distance <= inner {
        opacity
    } else {
        let falloff = (1.0 - distance) / (1.0 - inner).max(0.001);
        falloff.clamp(0.0, 1.0) * opacity
    }
}

fn rectangle_alpha(layer: &MaskLayer, x: u32, y: u32, width: u32, height: u32) -> f32 {
    if layer.width <= 0.0 || layer.height <= 0.0 {
        return 0.0;
    }

    let px = (x as f32 + 0.5) / width.max(1) as f32;
    let py = (y as f32 + 0.5) / height.max(1) as f32;
    let half_width = (layer.width / 2.0).max(0.001);
    let half_height = (layer.height / 2.0).max(0.001);
    let dx = (px - layer.x).abs();
    let dy = (py - layer.y).abs();
    let distance_to_edge = (half_width - dx).min(half_height - dy);
    let feather = layer.feather.clamp(0.0, 0.95);
    let opacity = layer.opacity.clamp(0.0, 1.0);

    if distance_to_edge <= 0.0 {
        return 0.0;
    }
    if feather <= 0.0 {
        return opacity;
    }

    let feather_width = feather * half_width.min(half_height);
    if distance_to_edge >= feather_width {
        opacity
    } else {
        (distance_to_edge / feather_width.max(0.001)).clamp(0.0, 1.0) * opacity
    }
}

fn linear_alpha(layer: &MaskLayer, x: u32, y: u32, width: u32, height: u32) -> f32 {
    let px = (x as f32 + 0.5) / width.max(1) as f32;
    let py = (y as f32 + 0.5) / height.max(1) as f32;
    let angle = layer.angle.unwrap_or(0.0).to_radians();
    let axis_x = angle.sin();
    let axis_y = -angle.cos();
    let projection = (px - layer.x) * axis_x + (py - layer.y) * axis_y;
    let feather = layer.feather.clamp(0.0, 0.95);
    let softness = feather.max(0.01);
    let opacity = layer.opacity.clamp(0.0, 1.0);
    ((projection / softness) + 0.5).clamp(0.0, 1.0) * opacity
}

fn distance_to_segment(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
    let vx = bx - ax;
    let vy = by - ay;
    let wx = px - ax;
    let wy = py - ay;
    let length_sq = vx * vx + vy * vy;
    if length_sq <= f32::EPSILON {
        return ((px - ax).powi(2) + (py - ay).powi(2)).sqrt();
    }
    let t = ((wx * vx + wy * vy) / length_sq).clamp(0.0, 1.0);
    let cx = ax + t * vx;
    let cy = ay + t * vy;
    ((px - cx).powi(2) + (py - cy).powi(2)).sqrt()
}

fn polygon_alpha(layer: &MaskLayer, x: u32, y: u32, width: u32, height: u32) -> f32 {
    let Some(points) = &layer.points else {
        return 0.0;
    };
    if points.len() < 3 {
        return 0.0;
    }

    let px = (x as f32 + 0.5) / width.max(1) as f32;
    let py = (y as f32 + 0.5) / height.max(1) as f32;
    let mut inside = false;
    let mut nearest_edge = f32::MAX;

    for index in 0..points.len() {
        let a = &points[index];
        let b = &points[(index + 1) % points.len()];
        let y_delta = b.y - a.y;
        let safe_y_delta = if y_delta.abs() <= f32::EPSILON {
            f32::EPSILON
        } else {
            y_delta
        };
        if ((a.y > py) != (b.y > py)) && (px < (b.x - a.x) * (py - a.y) / safe_y_delta + a.x) {
            inside = !inside;
        }
        nearest_edge = nearest_edge.min(distance_to_segment(px, py, a.x, a.y, b.x, b.y));
    }

    if !inside {
        return 0.0;
    }

    let opacity = layer.opacity.clamp(0.0, 1.0);
    let feather_width = (layer.feather.clamp(0.0, 0.95) * 0.25).max(0.0);
    if feather_width <= 0.0 || nearest_edge >= feather_width {
        opacity
    } else {
        (nearest_edge / feather_width.max(0.001)).clamp(0.0, 1.0) * opacity
    }
}

fn layer_alpha(layer: &MaskLayer, x: u32, y: u32, width: u32, height: u32) -> f32 {
    match layer.shape.as_str() {
        "rectangle" => rectangle_alpha(layer, x, y, width, height),
        "linear" => linear_alpha(layer, x, y, width, height),
        "polygon" => polygon_alpha(layer, x, y, width, height),
        _ => ellipse_alpha(layer, x, y, width, height),
    }
}

fn mask_alpha(
    operation: &GradeOperation,
    layers: &[MaskLayer],
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> f32 {
    let references: Vec<&MaskReference> = operation
        .masks
        .as_ref()
        .map(|masks| masks.iter().collect())
        .or_else(|| operation.mask.as_ref().map(|mask| vec![mask]))
        .unwrap_or_default();

    if references.is_empty() {
        return 1.0;
    }

    let has_add = references.iter().any(|reference| reference.mode == "add");
    let mut combined_alpha = if has_add { 0.0 } else { 1.0 };

    for reference in references {
        if reference.mode == "none" {
            continue;
        }
        let Some(layer_id) = &reference.layer_id else {
            continue;
        };
        let Some(layer) = layers.iter().find(|item| item.id == *layer_id) else {
            continue;
        };

        let alpha = layer_alpha(layer, x, y, width, height);
        if reference.mode == "subtract" {
            combined_alpha *= 1.0 - alpha;
        } else {
            combined_alpha = combined_alpha.max(alpha);
        }
    }

    if has_add {
        combined_alpha
    } else {
        combined_alpha.clamp(0.0, 1.0)
    }
}

fn apply_operation(img: &mut image::RgbaImage, operation: &GradeOperation, layers: &[MaskLayer]) {
    if !operation.enabled {
        return;
    }

    let blend = operation_blend(operation);
    if blend <= 0.0 {
        return;
    }

    match operation.operation_type.as_str() {
        "Exposure" => {
            let exposure = operation.values.get("Exposure").copied().unwrap_or(0.0);
            let factor = 2_f32.powf(exposure);
            let (width, height) = img.dimensions();
            for (x, y, pixel) in img.enumerate_pixels_mut() {
                let pixel_blend = blend * mask_alpha(operation, layers, x, y, width, height);
                if pixel_blend <= 0.0 {
                    continue;
                }
                for c in pixel.0.iter_mut().take(3) {
                    *c = blend_channel(*c, *c as f32 * factor, pixel_blend);
                }
            }
        }
        "BasicAdjustments" => {
            let contrast = operation
                .values
                .get("Contrast")
                .copied()
                .unwrap_or(0.0)
                .clamp(-100.0, 100.0)
                / 100.0;
            let highlights = operation
                .values
                .get("Highlights")
                .copied()
                .unwrap_or(0.0)
                .clamp(-100.0, 100.0);
            let shadows = operation
                .values
                .get("Shadows")
                .copied()
                .unwrap_or(0.0)
                .clamp(-100.0, 100.0);
            let whites = operation
                .values
                .get("Whites")
                .copied()
                .unwrap_or(0.0)
                .clamp(-100.0, 100.0);
            let blacks = operation
                .values
                .get("Blacks")
                .copied()
                .unwrap_or(0.0)
                .clamp(-100.0, 100.0);
            let contrast_factor = 1.0 + contrast * 1.25;
            let (width, height) = img.dimensions();
            for (x, y, pixel) in img.enumerate_pixels_mut() {
                let pixel_blend = blend * mask_alpha(operation, layers, x, y, width, height);
                if pixel_blend <= 0.0 {
                    continue;
                }
                let [r, g, b, a] = pixel.0;
                let luma = (r as f32 * 0.2126 + g as f32 * 0.7152 + b as f32 * 0.0722) / 255.0;
                let shadow_weight = (1.0 - luma * 2.0).clamp(0.0, 1.0);
                let highlight_weight = (luma * 2.0 - 1.0).clamp(0.0, 1.0);
                let black_weight = (1.0 - luma / 0.28).clamp(0.0, 1.0);
                let white_weight = ((luma - 0.72) / 0.28).clamp(0.0, 1.0);
                let tonal_offset = highlights * highlight_weight * 0.55
                    + shadows * shadow_weight * 0.55
                    + whites * white_weight * 0.8
                    + blacks * black_weight * 0.8;
                let adjust_channel = |value: u8| {
                    let contrasted = ((value as f32 / 255.0 - 0.5) * contrast_factor + 0.5) * 255.0;
                    contrasted + tonal_offset
                };
                pixel.0 = [
                    blend_channel(r, adjust_channel(r), pixel_blend),
                    blend_channel(g, adjust_channel(g), pixel_blend),
                    blend_channel(b, adjust_channel(b), pixel_blend),
                    a,
                ];
            }
        }
        "Temperature" | "WhiteBalance" => {
            let temperature = operation.values.get("Temperature").copied().unwrap_or(0.0);
            let tint = operation.values.get("Tint").copied().unwrap_or(0.0);
            let temp_norm = (temperature / 2000.0).clamp(-1.0, 1.0);
            let tint_norm = (tint / 100.0).clamp(-1.0, 1.0);
            let (width, height) = img.dimensions();
            for (x, y, pixel) in img.enumerate_pixels_mut() {
                let pixel_blend = blend * mask_alpha(operation, layers, x, y, width, height);
                if pixel_blend <= 0.0 {
                    continue;
                }
                let [r, g, b, a] = pixel.0;
                let adjusted_r = r as f32 + temp_norm * 30.0;
                let adjusted_g = g as f32 - tint_norm * 24.0;
                let adjusted_b = b as f32 - temp_norm * 30.0;
                pixel.0 = [
                    blend_channel(r, adjusted_r, pixel_blend),
                    blend_channel(g, adjusted_g, pixel_blend),
                    blend_channel(b, adjusted_b, pixel_blend),
                    a,
                ];
            }
        }
        "ChannelBalance" => {
            let red = operation
                .values
                .get("Red")
                .copied()
                .unwrap_or(0.0)
                .clamp(-100.0, 100.0)
                * 0.64;
            let green = operation
                .values
                .get("Green")
                .copied()
                .unwrap_or(0.0)
                .clamp(-100.0, 100.0)
                * 0.64;
            let blue = operation
                .values
                .get("Blue")
                .copied()
                .unwrap_or(0.0)
                .clamp(-100.0, 100.0)
                * 0.64;
            let (width, height) = img.dimensions();
            for (x, y, pixel) in img.enumerate_pixels_mut() {
                let pixel_blend = blend * mask_alpha(operation, layers, x, y, width, height);
                if pixel_blend <= 0.0 {
                    continue;
                }
                let [r, g, b, a] = pixel.0;
                pixel.0 = [
                    blend_channel(r, r as f32 + red, pixel_blend),
                    blend_channel(g, g as f32 + green, pixel_blend),
                    blend_channel(b, b as f32 + blue, pixel_blend),
                    a,
                ];
            }
        }
        "Saturation" => {
            let saturation = operation.values.get("Saturation").copied().unwrap_or(0.0);
            let factor = 1.0 + saturation / 100.0;
            let (width, height) = img.dimensions();
            for (x, y, pixel) in img.enumerate_pixels_mut() {
                let pixel_blend = blend * mask_alpha(operation, layers, x, y, width, height);
                if pixel_blend <= 0.0 {
                    continue;
                }
                let [r, g, b, a] = pixel.0;
                let luma = r as f32 * 0.2126 + g as f32 * 0.7152 + b as f32 * 0.0722;
                pixel.0 = [
                    blend_channel(r, luma + (r as f32 - luma) * factor, pixel_blend),
                    blend_channel(g, luma + (g as f32 - luma) * factor, pixel_blend),
                    blend_channel(b, luma + (b as f32 - luma) * factor, pixel_blend),
                    a,
                ];
            }
        }
        "HSV" => {
            let hue_shift = operation.values.get("Hue").copied().unwrap_or(0.0) / 360.0;
            let saturation_shift =
                operation.values.get("Saturation").copied().unwrap_or(0.0) / 100.0;
            let value_shift = operation.values.get("Value").copied().unwrap_or(0.0) / 100.0;
            let (width, height) = img.dimensions();
            for (x, y, pixel) in img.enumerate_pixels_mut() {
                let pixel_blend = blend * mask_alpha(operation, layers, x, y, width, height);
                if pixel_blend <= 0.0 {
                    continue;
                }
                let [r, g, b, a] = pixel.0;
                let (hue, saturation, value) = rgb_to_hsv(r, g, b);
                let adjusted_hue = (hue + hue_shift).rem_euclid(1.0);
                let adjusted_saturation = (saturation * (1.0 + saturation_shift)).clamp(0.0, 1.0);
                let adjusted_value = (value * (1.0 + value_shift)).clamp(0.0, 1.0);
                let (adjusted_r, adjusted_g, adjusted_b) =
                    hsv_to_rgb(adjusted_hue, adjusted_saturation, adjusted_value);
                pixel.0 = [
                    blend_channel(r, adjusted_r, pixel_blend),
                    blend_channel(g, adjusted_g, pixel_blend),
                    blend_channel(b, adjusted_b, pixel_blend),
                    a,
                ];
            }
        }
        "HueRange" => {
            let center = operation.values.get("Center").copied().unwrap_or(120.0);
            let range = operation.values.get("Range").copied().unwrap_or(36.0);
            let feather = operation.values.get("Feather").copied().unwrap_or(24.0);
            let hue_shift = operation.values.get("Hue").copied().unwrap_or(0.0) / 360.0;
            let saturation_shift =
                operation.values.get("Saturation").copied().unwrap_or(0.0) / 100.0;
            let value_shift = operation.values.get("Value").copied().unwrap_or(0.0) / 100.0;
            let (width, height) = img.dimensions();
            for (x, y, pixel) in img.enumerate_pixels_mut() {
                let mask_blend = mask_alpha(operation, layers, x, y, width, height);
                if mask_blend <= 0.0 {
                    continue;
                }
                let [r, g, b, a] = pixel.0;
                let (hue, saturation, value) = rgb_to_hsv(r, g, b);
                let selection = hue_range_weight(hue * 360.0, center, range, feather)
                    * saturation.clamp(0.0, 1.0);
                let pixel_blend = blend * mask_blend * selection;
                if pixel_blend <= 0.0 {
                    continue;
                }
                let adjusted_hue = (hue + hue_shift).rem_euclid(1.0);
                let adjusted_saturation = (saturation * (1.0 + saturation_shift)).clamp(0.0, 1.0);
                let adjusted_value = (value * (1.0 + value_shift)).clamp(0.0, 1.0);
                let (adjusted_r, adjusted_g, adjusted_b) =
                    hsv_to_rgb(adjusted_hue, adjusted_saturation, adjusted_value);
                pixel.0 = [
                    blend_channel(r, adjusted_r, pixel_blend),
                    blend_channel(g, adjusted_g, pixel_blend),
                    blend_channel(b, adjusted_b, pixel_blend),
                    a,
                ];
            }
        }
        "LUT" => {
            let Some(lut_path) = &operation.lut_path else {
                return;
            };
            let Ok(lut) = parse_cube_lut(lut_path) else {
                return;
            };
            let intensity = operation
                .values
                .get("Intensity")
                .copied()
                .unwrap_or(100.0)
                .clamp(0.0, 100.0)
                / 100.0;
            if intensity <= 0.0 {
                return;
            }
            let (width, height) = img.dimensions();
            for (x, y, pixel) in img.enumerate_pixels_mut() {
                let pixel_blend =
                    blend * intensity * mask_alpha(operation, layers, x, y, width, height);
                if pixel_blend <= 0.0 {
                    continue;
                }
                let [r, g, b, a] = pixel.0;
                let adjusted = sample_lut(&lut, r, g, b);
                pixel.0 = [
                    blend_channel(r, adjusted[0], pixel_blend),
                    blend_channel(g, adjusted[1], pixel_blend),
                    blend_channel(b, adjusted[2], pixel_blend),
                    a,
                ];
            }
        }
        "Curve" => {
            let (width, height) = img.dimensions();
            if let Some(master_lut) = build_curve_lut(&operation.values, "") {
                let red_lut = build_curve_lut(&operation.values, "Red");
                let green_lut = build_curve_lut(&operation.values, "Green");
                let blue_lut = build_curve_lut(&operation.values, "Blue");
                for (x, y, pixel) in img.enumerate_pixels_mut() {
                    let pixel_blend = blend * mask_alpha(operation, layers, x, y, width, height);
                    if pixel_blend <= 0.0 {
                        continue;
                    }
                    let [r, g, b, a] = pixel.0;
                    let master_r = master_lut[r as usize].round().clamp(0.0, 255.0) as u8;
                    let master_g = master_lut[g as usize].round().clamp(0.0, 255.0) as u8;
                    let master_b = master_lut[b as usize].round().clamp(0.0, 255.0) as u8;
                    pixel.0 = [
                        blend_channel(r, apply_lut(master_r, red_lut.as_ref()), pixel_blend),
                        blend_channel(g, apply_lut(master_g, green_lut.as_ref()), pixel_blend),
                        blend_channel(b, apply_lut(master_b, blue_lut.as_ref()), pixel_blend),
                        a,
                    ];
                }
            } else {
                let shadows = operation.values.get("Shadows").copied().unwrap_or(0.0);
                let highlights = operation.values.get("Highlights").copied().unwrap_or(0.0);
                for (x, y, pixel) in img.enumerate_pixels_mut() {
                    let pixel_blend = blend * mask_alpha(operation, layers, x, y, width, height);
                    if pixel_blend <= 0.0 {
                        continue;
                    }
                    let [r, g, b, a] = pixel.0;
                    let luma = (r as f32 * 0.2126 + g as f32 * 0.7152 + b as f32 * 0.0722) / 255.0;
                    let shadow_weight = (1.0 - luma * 2.0).clamp(0.0, 1.0);
                    let highlight_weight = (luma * 2.0 - 1.0).clamp(0.0, 1.0);
                    let offset =
                        shadows * shadow_weight * 0.8 + highlights * highlight_weight * 0.8;
                    pixel.0 = [
                        blend_channel(r, r as f32 + offset, pixel_blend),
                        blend_channel(g, g as f32 + offset, pixel_blend),
                        blend_channel(b, b as f32 + offset, pixel_blend),
                        a,
                    ];
                }
            }
        }
        _ => {}
    }
}

fn render_grade_image(
    img: DynamicImage,
    operations: &[GradeOperation],
    layers: &[MaskLayer],
    preview_max_dimension: Option<u32>,
) -> DynamicImage {
    let mut rgba = preview_image(img, preview_max_dimension).to_rgba8();
    for operation in operations {
        apply_operation(&mut rgba, operation, layers);
    }
    DynamicImage::ImageRgba8(rgba)
}

#[tauri::command]
fn open_image(path: String, state: State<AppState>) -> Result<LoadResult, String> {
    let img = image::open(&path).map_err(|e| format!("Failed to open image: {}", e))?;
    let file_size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let info = ImageInfo {
        width: img.width(),
        height: img.height(),
        file_size,
        channels: img.color().channel_count(),
    };
    let data_url = encode_png(&img)?;
    *state.current_image.lock().unwrap() = Some(img);
    Ok(LoadResult { info, data_url })
}

#[tauri::command]
fn apply_grade(
    state: State<AppState>,
    operations: Vec<GradeOperation>,
    layers: Vec<MaskLayer>,
    preview_max_dimension: Option<u32>,
) -> Result<String, String> {
    let img = state
        .current_image
        .lock()
        .unwrap()
        .as_ref()
        .ok_or("No image loaded")?
        .clone();
    let rendered = render_grade_image(img, &operations, &layers, preview_max_dimension);
    encode_png(&rendered)
}

#[tauri::command]
fn export_grade(
    state: State<AppState>,
    operations: Vec<GradeOperation>,
    layers: Vec<MaskLayer>,
    path: String,
) -> Result<String, String> {
    let format = image_format_from_path(&path)?;
    let img = state
        .current_image
        .lock()
        .unwrap()
        .as_ref()
        .ok_or("No image loaded")?
        .clone();
    let rendered = render_grade_image(img, &operations, &layers, None);
    if format == ImageFormat::Jpeg {
        rendered
            .to_rgb8()
            .save_with_format(&path, format)
            .map_err(|e| format!("Failed to export image: {}", e))?;
    } else {
        rendered
            .save_with_format(&path, format)
            .map_err(|e| format!("Failed to export image: {}", e))?;
    }
    Ok(path)
}

#[tauri::command]
fn save_project_file(path: String, contents: String) -> Result<String, String> {
    std::fs::write(&path, contents).map_err(|e| format!("Failed to save project: {}", e))?;
    Ok(path)
}

#[tauri::command]
fn load_project_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to load project: {}", e))
}

fn workspace_root() -> Result<PathBuf, String> {
    let current = std::env::current_dir()
        .map_err(|e| format!("Failed to inspect current directory: {}", e))?;
    for candidate in current.ancestors() {
        if candidate.join("package.json").exists() && candidate.join("src-tauri").exists() {
            return Ok(candidate.to_path_buf());
        }
    }
    Ok(current)
}

#[tauri::command]
fn read_agent_inbox() -> Result<Option<String>, String> {
    let path = workspace_root()?.join(".opengrade-agent.json");
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Failed to read agent inbox: {}", e))
}

#[tauri::command]
fn apply_exposure(state: State<AppState>, exposure: f32) -> Result<String, String> {
    let img = state
        .current_image
        .lock()
        .unwrap()
        .as_ref()
        .ok_or("No image loaded")?
        .clone();
    let factor = 2_f32.powf(exposure);
    let mut rgba = img.to_rgba8();
    for pixel in rgba.pixels_mut() {
        for c in pixel.0.iter_mut().take(3) {
            let v = (*c as f32 * factor).round().clamp(0.0, 255.0);
            *c = v as u8;
        }
    }
    encode_png(&DynamicImage::ImageRgba8(rgba))
}

#[tauri::command]
fn apply_temperature(state: State<AppState>, temperature: f32) -> Result<String, String> {
    let img = state
        .current_image
        .lock()
        .unwrap()
        .as_ref()
        .ok_or("No image loaded")?
        .clone();
    let temp_norm = (temperature / 2000.0).clamp(-1.0, 1.0);
    let mut rgba = img.to_rgba8();
    for pixel in rgba.pixels_mut() {
        let [r, g, b, a] = pixel.0;
        let r2 = (r as f32 + temp_norm * 30.0).clamp(0.0, 255.0) as u8;
        let b2 = (b as f32 - temp_norm * 30.0).clamp(0.0, 255.0) as u8;
        pixel.0 = [r2, g, b2, a];
    }
    encode_png(&DynamicImage::ImageRgba8(rgba))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            current_image: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            open_image,
            apply_grade,
            export_grade,
            save_project_file,
            load_project_file,
            read_agent_inbox,
            apply_exposure,
            apply_temperature,
        ])
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
