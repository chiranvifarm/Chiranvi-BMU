"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  atYourDoorStep,
  defaultFastSellingCards,
  defaultSubscriptionFastSellingCards,
  defaultSubscriptionPlans,
  orderByNineStep,
  startingProductPages,
  toProductSlug,
  type BadgeColour,
  type DeliveryStep,
  type InformationRow,
  type OneTimePack,
  type OneTimeProductPage,
  type PictureFit,
  type ProductKind,
  type ProductPage,
  type ProductPicture,
  type PublishStatus,
  type ShopCategory,
  type SubscriptionPlanSetting,
  type SubscriptionProductPage,
  FREE_DELIVERY_FROM,
} from "@/components/product/product-page-data";
import {
  addProductPage,
  deleteProductPage,
  isProductSlugTaken,
  isStartingProductPage,
  restoreStartingProductPage,
  updateProductPage,
  useHiddenStartingProductSlugs,
  useProductPages,
} from "@/store/product-pages-store";
import {
  NOODLES_KINDS,
  NOODLES_KIND_NAMES,
  OTHER_FLAVOUR_SLOT,
  ROW_SIZE,
  noodlesPageOf,
  sameFlavourSlot,
  type NoodlesKind,
  type RowSlot,
} from "@/store/admin-product-rows-store";
import { addProduct, addProductCategory, removeProduct, useProductCategories, useShopProducts, type ProductCategory } from "@/store/products-store";
import { AdminDialog, AdminDialogField, adminInputClassName, useIsPanelOwner } from "./admin-shared";
import styles from "./admin-product-page-form.module.css";

/*
  Product pages in the Chiranvi Panel (on Products & pricing):
  - ProductPageForm: "Add product" in three steps, and "Edit" of any product page with the same form.
      1. kind      Subscription (like milk: plans + one-time tab) or One-time purchase (like ghee: pack
                   sizes), and the category the product card goes under (Add only)
      2. details   the form for that kind: texts, pictures, prices, packs or plans, delivery steps, review,
                   product information and nutrition, draft or published
      3. saved     links to open (or preview) /products/<address>
  - ProductPageCardActions: the page's Open, Edit page, Delete page (and Restore) buttons, inside its card's
    pop-up on Products & pricing (the cards themselves look as before).
  The pages are drawn by the template for their kind (components/product/*-product-page.tsx); nothing is
  coded per product. Saved by store/product-pages-store.ts: in this browser until Supabase is connected, so
  for now changes show only in this browser. A product added here also gets its card(s) on Products &
  pricing (products-store); editing or deleting it updates or removes those cards too.
*/

type Step = "kind" | "details" | "saved";

type PackRow = { label: string; size: string; price: string; originalPrice: string; tag: "" | "Best value" | "Most popular"; itemCount: string };
type PlanRow = { label: string; months: string; days: string; percentOff: string; tag: "" | "Best value" | "Most popular" };

const BADGE_COLOURS: { value: BadgeColour; label: string }[] = [
  { value: "green", label: "Light green, green text" },
  { value: "gold", label: "Light yellow, gold text" },
  { value: "cream", label: "Light yellow, dark text" },
  { value: "grey", label: "Light grey, dark text" },
];

// "Price shown per" choices for one-time products (unit label → how big one unit is in the pack sizes' unit)
const PRICE_BREAKDOWN_CHOICES = [
  { value: "100 g", label: "per 100 g (pack sizes in g)", unitSize: 100 },
  { value: "100 ml", label: "per 100 ml (pack sizes in ml)", unitSize: 100 },
  { value: "kg", label: "per kg (pack sizes in kg)", unitSize: 1 },
  { value: "litre", label: "per litre (pack sizes in litres)", unitSize: 1 },
  { value: "item-count", label: "about how many items (e.g. idlis)", unitSize: 0 },
];

// "auto" (sized from the picture's shape, see fitForPicture) is the first choice; these force a size
const PICTURE_SHAPES: { value: string; label: string; fit: PictureFit }[] = [
  { value: "tall", label: "Tall (bottle, jar, pouch)", fit: { heightPercent: 84 } },
  { value: "wide", label: "Wide (box, board)", fit: { widthPercent: 72, heightPercent: 80 } },
  { value: "square", label: "Square (pack with props)", fit: { widthPercent: 78, heightPercent: 88 } },
];

// Products & pricing category → the All products page's filter (an added category: none, so "Others")
const SHOP_CATEGORY_FROM_PANEL_CATEGORY: Partial<Record<ProductCategory, ShopCategory>> = {
  Milk: "Milk",
  Paneer: "Paneer",
  "Ghee & butter": "Ghee",
  Others: "Others",
};

const emptyPack = (): PackRow => ({ label: "", size: "", price: "", originalPrice: "", tag: "", itemCount: "" });

// Product information and nutrition rows a new product starts with (labels filled in, values to type)
const startingInformationRows: InformationRow[] = [
  { label: "Ingredients", value: "" },
  { label: "Net quantity", value: "" },
  { label: "Shelf life", value: "" },
  { label: "Storage", value: "" },
  { label: "Country of origin", value: "India" },
  { label: "Manufactured by", value: "Chiranvi Farm, [add address]" },
  { label: "FSSAI Lic. No.", value: "[add number]" },
];

const startingNutritionRows: InformationRow[] = [
  { label: "Energy", value: "" },
  { label: "Protein", value: "" },
  { label: "Total fat", value: "" },
  { label: "Carbohydrate", value: "" },
];

// Example values shown in empty value fields
const INFORMATION_EXAMPLES: Record<string, string> = {
  Ingredients: "Milk fat from A2 desi cow milk",
  "Net quantity": "250 ml / 500 ml / 1 litre",
  "Shelf life": "Best within 9 months",
  Storage: "Keep at room temperature",
  "Country of origin": "India",
  "Manufactured by": "Chiranvi Farm, Bengaluru",
  "FSSAI Lic. No.": "14-digit licence number",
  Energy: "897 kcal",
  Protein: "0 g",
  "Total fat": "99.7 g",
  Carbohydrate: "0 g",
};

const textOf = (value: number | undefined) => (value === undefined ? "" : String(value));

/*
  A picture chosen from the computer, made ready for the product page (kept as text, a data URL, until
  Supabase Storage exists). Any type (JPG, PNG, WebP, …):
  1. drawn at full quality (small pictures scaled up twice, smoothly; big ones down to 1600 px);
  2. the background removed, when the picture is not already see-through: its colour is taken from the
     picture's border (white, off-white, cream or grey, even with JPG noise), and everything close to it
     that touches the edges is cleared, so the same colour inside the product stays; small notches are
     filled back in;
  3. a clean edge: the outline pixels fade by how close they are to the background, the background's tint
     is taken out of them (no white halo), and the outline is softened a little;
  4. a soft shadow drawn only below the product (an oval on the "floor"), so it sits on the gold ring and
     green card;
  5. saved as a transparent WebP (the same look as a PNG, many times smaller, so it fits the browser's storage).
*/
const LONGEST_SIDE_LIMIT = 1600;
// Biggest file the admin may upload (bigger ones are refused with a message)
export const PICTURE_UPLOAD_LIMIT_MB = 25;
export const PICTURE_TOO_BIG_MESSAGE = `That picture is bigger than ${PICTURE_UPLOAD_LIMIT_MB} MB. Choose a smaller one.`;
// How far (in colour) from the background a pixel may be and still count as background: enough for JPG
// noise, small enough not to eat light parts of the product (clear plastic, white labels) that touch it
const BACKGROUND_TOLERANCE = 26;
// How many rows of the outline may get the product's own colour where they are a pale blend (the white
// rim): one row per 50 px of the picture's longest side, 6 to 24 (blurry or enlarged photos have wider rims)
const edgeRecolourRows = (width: number, height: number) => Math.min(24, Math.max(6, Math.round(Math.max(width, height) / 50)));

function loadPicture(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const picture = new window.Image();
    picture.onload = () => resolve(picture);
    picture.onerror = () => reject(new Error("Not a picture"));
    picture.src = objectUrl;
  });
}

// The background colour: the middle value of the pixels along the picture's border
function findBorderColour(pixels: Uint8ClampedArray, width: number, height: number) {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  const sample = (pixel: number) => {
    reds.push(pixels[pixel * 4]);
    greens.push(pixels[pixel * 4 + 1]);
    blues.push(pixels[pixel * 4 + 2]);
  };
  const step = Math.max(1, Math.floor(Math.min(width, height) / 200));
  for (let x = 0; x < width; x += step) {
    sample(x);
    sample((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += step) {
    sample(y * width);
    sample(y * width + width - 1);
  }
  const middle = (values: number[]) => values.sort((first, second) => first - second)[Math.floor(values.length / 2)];
  return [middle(reds), middle(greens), middle(blues)] as const;
}

function removeBackground(pixels: Uint8ClampedArray, width: number, height: number, removesOldShadow: boolean) {
  const pixelCount = width * height;
  const [backgroundRed, backgroundGreen, backgroundBlue] = findBorderColour(pixels, width, height);
  const distance = new Float32Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const red = pixels[pixel * 4] - backgroundRed;
    const green = pixels[pixel * 4 + 1] - backgroundGreen;
    const blue = pixels[pixel * 4 + 2] - backgroundBlue;
    distance[pixel] = Math.sqrt(red * red + green * green + blue * blue);
  }

  // 1. Background: close to the border colour and connected to the edges (flood fill)
  let background = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;
  const push = (pixel: number) => {
    if (!background[pixel] && distance[pixel] <= BACKGROUND_TOLERANCE) {
      background[pixel] = 1;
      queue[tail++] = pixel;
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    if (x > 0) push(pixel - 1);
    if (x < width - 1) push(pixel + 1);
    if (pixel >= width) push(pixel - width);
    if (pixel + width < pixelCount) push(pixel + width);
  }

  /*
    The photo's own grey floor shadow goes too (the page adds its own soft shadow), when asked: grey pixels
    below the product's coloured part in their column, connected to the background. Columns just outside
    the product borrow the nearest coloured column's bottom; columns far from any colour are left alone.
    Off for white products (a milk bottle's white bottom under a coloured label would look like shadow).
  */
  const lowestColouredRow = new Int32Array(width).fill(-1);
  for (let pixel = 0; pixel < pixelCount && removesOldShadow; pixel++) {
    const red = pixels[pixel * 4];
    const green = pixels[pixel * 4 + 1];
    const blue = pixels[pixel * 4 + 2];
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 25) lowestColouredRow[pixel % width] = Math.floor(pixel / width);
  }
  const borrowReach = Math.round(width * 0.1);
  const ownRows = lowestColouredRow.slice();
  for (let x = 0; x < width; x++) {
    if (ownRows[x] >= 0) continue;
    for (let offset = 1; offset <= borrowReach; offset++) {
      const nearby = x - offset >= 0 && ownRows[x - offset] >= 0 ? ownRows[x - offset] : x + offset < width && ownRows[x + offset] >= 0 ? ownRows[x + offset] : -1;
      if (nearby >= 0) {
        lowestColouredRow[x] = nearby;
        break;
      }
    }
  }
  const isOldShadow = (pixel: number) => {
    const x = pixel % width;
    const red = pixels[pixel * 4];
    const green = pixels[pixel * 4 + 1];
    const blue = pixels[pixel * 4 + 2];
    // Grey enough (a little warmth from the product is fine) and not too dark (dark parts of the product stay)
    return (
      lowestColouredRow[x] >= 0 &&
      Math.floor(pixel / width) > lowestColouredRow[x] &&
      Math.max(red, green, blue) - Math.min(red, green, blue) <= 18 &&
      Math.min(red, green, blue) >= 85
    );
  };
  head = 0;
  tail = 0;
  for (let pixel = 0; pixel < pixelCount; pixel++) if (background[pixel]) queue[tail++] = pixel;
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    const neighbours = [x > 0 ? pixel - 1 : -1, x < width - 1 ? pixel + 1 : -1, pixel - width, pixel + width];
    for (const neighbour of neighbours) {
      if (neighbour >= 0 && neighbour < pixelCount && !background[neighbour] && isOldShadow(neighbour)) {
        background[neighbour] = 1;
        queue[tail++] = neighbour;
      }
    }
  }

  // 2. Smooth the outline: shrink the background by 5 pixels and grow it back (fills notches)
  const touches = (mask: Uint8Array, pixel: number, value: number) => {
    const x = pixel % width;
    return (
      (x > 0 && mask[pixel - 1] === value) ||
      (x < width - 1 && mask[pixel + 1] === value) ||
      (pixel >= width && mask[pixel - width] === value) ||
      (pixel + width < pixelCount && mask[pixel + width] === value)
    );
  };
  for (let step = 0; step < 5; step++) {
    const shrunk = background.slice();
    for (let pixel = 0; pixel < pixelCount; pixel++) if (background[pixel] && touches(background, pixel, 0)) shrunk[pixel] = 0;
    background = shrunk;
  }
  for (let step = 0; step < 5; step++) {
    const grown = background.slice();
    for (let pixel = 0; pixel < pixelCount; pixel++) if (!background[pixel] && touches(background, pixel, 1)) grown[pixel] = 1;
    background = grown;
  }

  // 3. The edge band (the 3 pixels of product next to the background): fade by closeness to the
  //    background and take the background's tint out of the colour (no halo). The rows after the
  //    third are only recoloured (step 4), as blurry or JPG photos carry the white into the product.
  const recolourRows = edgeRecolourRows(width, height);
  const bandDepth = new Uint8Array(pixelCount); // 0: background or deep inside; 1 and up: rows of the band
  let edge = background;
  for (let depth = 1; depth <= recolourRows; depth++) {
    const next = edge.slice();
    for (let pixel = 0; pixel < pixelCount; pixel++) {
      if (!edge[pixel] && touches(edge, pixel, 1)) {
        bandDepth[pixel] = depth;
        next[pixel] = 1;
      }
    }
    edge = next;
  }
  const alpha = new Float32Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if (background[pixel]) continue;
    if (!bandDepth[pixel] || bandDepth[pixel] > 3) {
      alpha[pixel] = 1;
      continue;
    }
    const closeness = (distance[pixel] - BACKGROUND_TOLERANCE * 0.6) / (BACKGROUND_TOLERANCE * 1.4);
    alpha[pixel] = Math.max(0, Math.min(1, closeness + (bandDepth[pixel] - 1) * 0.25));
    // The outermost row is always mostly see-through, so no light rim shows on the gold and green
    if (bandDepth[pixel] === 1) alpha[pixel] = Math.min(alpha[pixel], 0.4);
  }

  // Soften the outline: average the alpha of the band with its neighbours (3 × 3)
  const softAlpha = alpha.slice();
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if (!bandDepth[pixel] && !(background[pixel] && touches(background, pixel, 0))) continue;
    const x = pixel % width;
    const y = (pixel - x) / width;
    let total = 0;
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        total += alpha[ny * width + nx];
        count++;
      }
    }
    softAlpha[pixel] = total / count;
  }

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const pixelAlpha = softAlpha[pixel];
    if (pixelAlpha > 0 && pixelAlpha < 1) {
      // Take the background colour out of a half see-through edge pixel
      pixels[pixel * 4] = Math.max(0, Math.min(255, (pixels[pixel * 4] - (1 - pixelAlpha) * backgroundRed) / pixelAlpha));
      pixels[pixel * 4 + 1] = Math.max(0, Math.min(255, (pixels[pixel * 4 + 1] - (1 - pixelAlpha) * backgroundGreen) / pixelAlpha));
      pixels[pixel * 4 + 2] = Math.max(0, Math.min(255, (pixels[pixel * 4 + 2] - (1 - pixelAlpha) * backgroundBlue) / pixelAlpha));
    }
    pixels[pixel * 4 + 3] = Math.round(pixels[pixel * 4 + 3] * pixelAlpha);
  }

  /*
    4. Edge colour: the product's own colour (from just past the band) is carried outward, and a band pixel
    that is a pale blend of it and the background (lighter, and lying between the two colours) takes it on:
    fully at the outline, less further in, so the outline matches the product (no white line, no pale
    gradient) while highlights inside stay. Darker edges and real light parts of the product (a white cap
    or label is not a blend) are left as they are.
  */
  const isInside = (pixel: number) => !background[pixel] && !bandDepth[pixel];
  const brightness = (pixel: number) => pixels[pixel * 4] * 0.299 + pixels[pixel * 4 + 1] * 0.587 + pixels[pixel * 4 + 2] * 0.114;
  // The product's colour behind each band pixel (from the inside, passed outward row by row)
  const productColour = new Float32Array(pixelCount * 3);
  /*
    A pixel as a blend of the inside colour and the background colour: how much background is in it
    (0 to 1) and how far it is from being a pure blend (0: exactly one)
  */
  const asBlend = (pixel: number, insideRed: number, insideGreen: number, insideBlue: number) => {
    const lineRed = backgroundRed - insideRed;
    const lineGreen = backgroundGreen - insideGreen;
    const lineBlue = backgroundBlue - insideBlue;
    const lineLength = lineRed * lineRed + lineGreen * lineGreen + lineBlue * lineBlue || 1;
    const red = pixels[pixel * 4] - insideRed;
    const green = pixels[pixel * 4 + 1] - insideGreen;
    const blue = pixels[pixel * 4 + 2] - insideBlue;
    const share = Math.max(0, Math.min(1, (red * lineRed + green * lineGreen + blue * lineBlue) / lineLength));
    return { share, offLine: Math.hypot(red - share * lineRed, green - share * lineGreen, blue - share * lineBlue) };
  };
  for (let depth = recolourRows; depth >= 1; depth--) {
    for (let pixel = 0; pixel < pixelCount; pixel++) {
      if (bandDepth[pixel] !== depth) continue;
      const x = pixel % width;
      const y = (pixel - x) / width;
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbour = ny * width + nx;
          // The inside's own colour, or the product colour already found for a deeper band row
          if (isInside(neighbour)) {
            red += pixels[neighbour * 4];
            green += pixels[neighbour * 4 + 1];
            blue += pixels[neighbour * 4 + 2];
          } else if (bandDepth[neighbour] > depth) {
            red += productColour[neighbour * 3];
            green += productColour[neighbour * 3 + 1];
            blue += productColour[neighbour * 3 + 2];
          } else continue;
          count++;
        }
      }
      // No deeper neighbour (a thin part): its own colour carries on outward
      const [insideRed, insideGreen, insideBlue] = count
        ? [red / count, green / count, blue / count]
        : [pixels[pixel * 4], pixels[pixel * 4 + 1], pixels[pixel * 4 + 2]];
      const insideBrightness = insideRed * 0.299 + insideGreen * 0.587 + insideBlue * 0.114;
      // A white rim fades out going inward; a light part of the product (a wooden rim beside dark
      // powder) stays just as pale further in, so a pixel paler than the fade allows for its row stays
      const blend = asBlend(pixel, insideRed, insideGreen, insideBlue);
      const allowedShare = 0.95 * (1 - (depth - 1) / recolourRows);
      const isLighter = brightness(pixel) > insideBrightness + 6;
      const isPaleBlend = isLighter && blend.offLine <= 24 && blend.share <= allowedShare;
      // A clearly lighter part of the product (not a blend) passes its own colour outward, so a wooden
      // rim's outline gets wood, not powder; everything else passes on the product colour it was given
      const isLightPartOfProduct = isLighter && !isPaleBlend;
      productColour[pixel * 3] = isLightPartOfProduct ? pixels[pixel * 4] : insideRed;
      productColour[pixel * 3 + 1] = isLightPartOfProduct ? pixels[pixel * 4 + 1] : insideGreen;
      productColour[pixel * 3 + 2] = isLightPartOfProduct ? pixels[pixel * 4 + 2] : insideBlue;
      if (!isPaleBlend) continue;
      // Fully the product's colour at the outline, half of it at the band's inner end
      const strength = 1 - ((depth - 1) / recolourRows) * 0.5;
      pixels[pixel * 4] = Math.round(pixels[pixel * 4] + (insideRed - pixels[pixel * 4]) * strength);
      pixels[pixel * 4 + 1] = Math.round(pixels[pixel * 4 + 1] + (insideGreen - pixels[pixel * 4 + 1]) * strength);
      pixels[pixel * 4 + 2] = Math.round(pixels[pixel * 4 + 2] + (insideBlue - pixels[pixel * 4 + 2]) * strength);
    }
  }
}

/*
  How big a picture shows on its product page, from its shape, so every product looks the same size as
  the others: tall ones (bottle, jar, pouch) by height; wider ones (bowl, box, board) by width, wider
  pictures a little wider, never taller than the tall ones.
*/
export function fitForPicture(imageWidth: number, imageHeight: number): PictureFit {
  const shape = imageWidth / imageHeight;
  if (shape < 0.85) return { heightPercent: 82 };
  return { widthPercent: Math.round(Math.min(76, Math.max(52, 58 + (shape - 1.1) * 35))), heightPercent: 78 };
}

// The product's box (the area of pixels that are mostly solid), to place the shadow under it
function findSolidBox(pixels: Uint8ClampedArray, width: number, height: number) {
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 128) {
        if (x < left) left = x;
        if (x > right) right = x;
        bottom = y;
      }
    }
  }
  return right < 0 ? null : { left, right, bottom };
}

// Also used by "Change photo" in the card pop-up on Products & pricing, so every photo is prepared the same way
export async function processPictureFile(file: File, removesOldShadow: boolean): Promise<Omit<ProductPicture, "alt">> {
  if (file.size > PICTURE_UPLOAD_LIMIT_MB * 1024 * 1024) throw new Error(PICTURE_TOO_BIG_MESSAGE);
  const picture = await loadPicture(file);
  const originalWidth = picture.naturalWidth;
  const originalHeight = picture.naturalHeight;
  const longestSide = Math.max(originalWidth, originalHeight);
  const scale = longestSide > LONGEST_SIDE_LIMIT ? LONGEST_SIDE_LIMIT / longestSide : longestSide * 2 <= LONGEST_SIDE_LIMIT ? 2 : 1;
  const width = Math.round(originalWidth * scale);
  const height = Math.round(originalHeight * scale);

  // 1. Full-quality drawing
  const productCanvas = document.createElement("canvas");
  productCanvas.width = width;
  productCanvas.height = height;
  const productContext = productCanvas.getContext("2d", { willReadFrequently: true });
  if (!productContext) throw new Error("No canvas");
  productContext.imageSmoothingEnabled = true;
  productContext.imageSmoothingQuality = "high";
  productContext.drawImage(picture, 0, 0, width, height);
  URL.revokeObjectURL(picture.src);

  // 2–3. Background removed (unless the picture is already see-through at its corners)
  const imageData = productContext.getImageData(0, 0, width, height);
  const cornerAlphas = [0, width - 1, (height - 1) * width, height * width - 1].map((pixel) => imageData.data[pixel * 4 + 3]);
  if (cornerAlphas.every((cornerAlpha) => cornerAlpha > 250)) removeBackground(imageData.data, width, height, removesOldShadow);
  productContext.putImageData(imageData, 0, 0);

  // 4. A soft oval shadow only below the product (a little room is added under it)
  const box = findSolidBox(imageData.data, width, height);
  const shadowRoom = Math.round(height * 0.05);
  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = width;
  finalCanvas.height = height + shadowRoom;
  const finalContext = finalCanvas.getContext("2d");
  if (!finalContext) throw new Error("No canvas");
  if (box) {
    const centreX = (box.left + box.right) / 2;
    // Just under the product's bottom edge, so most of the oval shows below flat-bottomed packs too
    const centreY = box.bottom + shadowRoom * 0.4;
    const radiusX = Math.max(10, (box.right - box.left) * 0.48);
    const radiusY = Math.max(4, height * 0.038);
    finalContext.save();
    finalContext.translate(centreX, centreY);
    finalContext.scale(1, radiusY / radiusX);
    const shadow = finalContext.createRadialGradient(0, 0, 0, 0, 0, radiusX);
    shadow.addColorStop(0, "rgba(10, 30, 16, 0.5)");
    shadow.addColorStop(0.55, "rgba(10, 30, 16, 0.22)");
    shadow.addColorStop(1, "rgba(10, 30, 16, 0)");
    finalContext.fillStyle = shadow;
    finalContext.beginPath();
    finalContext.arc(0, 0, radiusX, 0, Math.PI * 2);
    finalContext.fill();
    finalContext.restore();
  }
  finalContext.drawImage(productCanvas, 0, 0);

  // 5. Transparent WebP (browsers that cannot write WebP give a PNG instead)
  return { imageSource: finalCanvas.toDataURL("image/webp", 0.92), imageWidth: width, imageHeight: height + shadowRoom };
}

/*
  Add (no editingPage) or Edit (editingPage: the form starts filled in from it, the kind and address stay as
  they are, and anything the form does not show, such as the exact picture size or the fast selling rows,
  is kept).
*/
export function ProductPageForm({
  editingPage,
  onClose,
  showToast,
  embedded,
  onDelete,
}: {
  editingPage?: ProductPage;
  onClose: () => void;
  showToast: (message: string) => void;
  /*
    Inside a product card's pop-up on Products & pricing: no dialog of its own; the card's name and photo
    are the page's (no separate fields), its cards are left to the pop-up, and the pop-up's Save changes
    calls the save given to registerSave (true when saved). The prices are set only here (the pop-up has no
    price fields of its own): onSaved hands the saved page back so the card takes its prices, and without
    canChangePrices a changed price is refused (prices are changed only by the owner).
  */
  embedded?: {
    registerSave: (save: () => boolean) => void;
    name: string;
    photo?: { imageSource: string; imageWidth: number; imageHeight: number };
    onSaved?: (page: ProductPage) => void;
    canChangePrices?: boolean;
    // Adding a brand-new product in the pop-up (no editingPage): its kind and Products & pricing category
    newKind?: ProductKind;
    category?: ProductCategory;
  };
  onDelete?: () => void; // shows "Delete product" in the form (a page without a card of its own)
}) {
  const isEditing = Boolean(editingPage);
  // Editing a product's prices is for the owner only (the database refuses anyone else): the price sections freeze
  const isOwner = useIsPanelOwner();
  const pricesLockedNote = isEditing && !isOwner ? "Only the owner can change prices. These stay as they are." : undefined;
  const oneTimeEditing = editingPage?.kind === "one-time" ? editingPage : undefined;
  const subscriptionEditing = editingPage?.kind === "subscription" ? editingPage : undefined;
  const shopProducts = useShopProducts();
  const linkedCard = shopProducts.find((product) => editingPage?.panelCardIds?.includes(product.productId));

  // A new product added in the pop-up already has its kind, so it starts at the details
  const [step, setStep] = useState<Step>(isEditing || embedded?.newKind ? "details" : "kind");
  const [kind, setKind] = useState<ProductKind>(editingPage?.kind ?? embedded?.newKind ?? "one-time");
  const [category, setCategory] = useState<ProductCategory>(linkedCard?.category ?? "Others");
  const [problems, setProblems] = useState<string[]>([]);
  const [savedSlug, setSavedSlug] = useState("");

  // ---- Both kinds ----
  const [name, setName] = useState(editingPage?.name ?? "");
  const [slugTyped, setSlugTyped] = useState("");
  const slug = editingPage ? editingPage.slug : toProductSlug(slugTyped || (embedded ? embedded.name : name));
  const [tagline, setTagline] = useState(editingPage?.tagline ?? "");
  const [description, setDescription] = useState(editingPage?.description ?? "");
  const [badgeText, setBadgeText] = useState(editingPage?.badge.text ?? "");
  const [badgeColour, setBadgeColour] = useState<BadgeColour>(editingPage?.badge.colour ?? (embedded?.newKind === "subscription" ? "grey" : "green"));
  const [ratingScore, setRatingScore] = useState(editingPage?.rating.score ?? "4.8");
  const [ratingCount, setRatingCount] = useState(editingPage?.rating.count ?? "");
  const [highlightsText, setHighlightsText] = useState(editingPage?.highlights.join(", ") ?? "");
  const [pictures, setPictures] = useState<Omit<ProductPicture, "alt">[]>(editingPage?.pictures ?? []);
  const [pictureAddress, setPictureAddress] = useState("");
  // Shown while a chosen picture is being converted, and after
  const [pictureStatus, setPictureStatus] = useState("");
  // Remove the photo's own grey floor shadow when preparing a picture (untick for white products)
  const [removesOldShadow, setRemovesOldShadow] = useState(true);
  // Editing: "keep" leaves the picture size exactly as it is
  const [pictureShape, setPictureShape] = useState(isEditing ? "keep" : "auto");
  const [hasPictureShadow, setHasPictureShadow] = useState(editingPage?.hasPictureShadow ?? false);
  // A new product added in the pop-up starts with the chosen kind's usual middle step (as chooseKind sets)
  const [middleStep, setMiddleStep] = useState(
    editingPage
      ? { title: editingPage.deliverySteps[1]?.title ?? "", detail: editingPage.deliverySteps[1]?.detail ?? "" }
      : embedded?.newKind === "subscription"
        ? { title: "Milked at 5 AM", detail: "Chilled within minutes" }
        : embedded?.newKind === "one-time"
          ? { title: "Packed fresh", detail: "This week’s batch" }
          : { title: "", detail: "" },
  );
  const [lastStepDetail, setLastStepDetail] = useState(editingPage?.deliverySteps[2]?.detail ?? "By 7 AM");
  const [reviewQuote, setReviewQuote] = useState(editingPage?.review.quote ?? "");
  const [reviewName, setReviewName] = useState(editingPage?.review.name ?? "");
  const [reviewArea, setReviewArea] = useState(editingPage?.review.area ?? "");
  const [status, setStatus] = useState<PublishStatus>(editingPage?.status ?? "published");
  // The row under the page: the shared list (Products & pricing → Product rows) unless this page has its own
  const [hasOwnProductRow, setHasOwnProductRow] = useState(Boolean(editingPage?.productRowOverride?.length));
  const [ownProductRow, setOwnProductRow] = useState<RowSlot[]>(editingPage?.productRowOverride ?? []);

  // ---- One-time ----
  const [ratingNote, setRatingNote] = useState(oneTimeEditing?.ratingNote ?? "");
  const [packs, setPacks] = useState<PackRow[]>(
    oneTimeEditing
      ? oneTimeEditing.packs.map((pack) => ({
          label: pack.label,
          size: String(pack.size),
          price: String(pack.price),
          originalPrice: textOf(pack.originalPrice),
          tag: pack.tag ?? "",
          itemCount: textOf(pack.itemCount),
        }))
      : [emptyPack()],
  );
  const [defaultPackIndex, setDefaultPackIndex] = useState(
    Math.max(0, oneTimeEditing?.packs.findIndex((pack) => pack.packId === oneTimeEditing.defaultPackId) ?? 0),
  );
  const [priceShownPer, setPriceShownPer] = useState(
    oneTimeEditing ? (oneTimeEditing.priceBreakdown.kind === "item-count" ? "item-count" : oneTimeEditing.priceBreakdown.unitLabel) : "100 g",
  );
  const [itemLabel, setItemLabel] = useState(oneTimeEditing?.priceBreakdown.kind === "item-count" ? oneTimeEditing.priceBreakdown.itemLabel : "");
  const [taxNote, setTaxNote] = useState(oneTimeEditing?.priceBreakdown.taxNote ?? "Inclusive of all taxes");
  const [packWord, setPackWord] = useState(oneTimeEditing?.cartPackWord ?? "pack");
  const [noteText, setNoteText] = useState(oneTimeEditing?.note.text ?? "");
  const [noteTone, setNoteTone] = useState<"fresh" | "warning">(oneTimeEditing?.note.tone ?? "fresh");
  const [freeDeliveryKind, setFreeDeliveryKind] = useState<"from" | "always">(oneTimeEditing?.freeDelivery.kind ?? "from");
  const [informationRows, setInformationRows] = useState<InformationRow[]>(oneTimeEditing?.productInformation ?? subscriptionEditing?.productInformation ?? startingInformationRows);
  const [nutritionRows, setNutritionRows] = useState<InformationRow[]>(oneTimeEditing?.nutritionFacts ?? subscriptionEditing?.nutritionFacts ?? startingNutritionRows);
  const [nutritionBasis, setNutritionBasis] = useState(oneTimeEditing?.nutritionBasis ?? subscriptionEditing?.nutritionBasis ?? "per 100 g (approx.)");

  // ---- Subscription ----
  const [timingsStripText, setTimingsStripText] = useState(
    subscriptionEditing?.timingsStripText ?? "Order by 9 PM for delivery tomorrow by 7 AM · Free delivery on all subscriptions",
  );
  const [price, setPrice] = useState(textOf(subscriptionEditing?.price));
  const [originalPrice, setOriginalPrice] = useState(textOf(subscriptionEditing?.originalPrice));
  // Milk: the 500 ml bottle (on or off) and its own price (empty: half the 1 litre price, rounded up)
  const [hasHalfLitreBottle, setHasHalfLitreBottle] = useState(subscriptionEditing?.hasHalfLitreBottle ?? false);
  const [halfLitrePrice, setHalfLitrePrice] = useState(textOf(subscriptionEditing?.halfLitrePrice));
  const [unitName, setUnitName] = useState(subscriptionEditing?.unitName ?? "litre");
  const [unitShort, setUnitShort] = useState(subscriptionEditing?.unitShort ?? "L");
  const [packSize, setPackSize] = useState(subscriptionEditing?.packSize ?? "1 litre glass bottle");
  const [packShort, setPackShort] = useState(subscriptionEditing?.packShort ?? "1 L");
  const [billLabel, setBillLabel] = useState(subscriptionEditing?.billLabel ?? "");
  const [itemWord, setItemWord] = useState(subscriptionEditing?.itemWord.one ?? "bottle");
  const [homesBold, setHomesBold] = useState(subscriptionEditing?.homesNote.bold ?? "");
  const [homesRest, setHomesRest] = useState(subscriptionEditing?.homesNote.rest ?? "");
  const [plans, setPlans] = useState<PlanRow[]>(
    (subscriptionEditing?.plans ?? defaultSubscriptionPlans).map((plan) => ({
      label: plan.label,
      months: String(plan.months),
      days: String(plan.days),
      percentOff: String(plan.percentOff),
      tag: plan.tag ?? "",
    })),
  );
  const [defaultPlanIndex, setDefaultPlanIndex] = useState(
    subscriptionEditing ? Math.max(0, subscriptionEditing.plans.findIndex((plan) => plan.planId === subscriptionEditing.defaultPlanId)) : 1,
  );
  // The tag on its product cards (one-time products use the tag of the pack shown first instead)
  const [cardTag, setCardTag] = useState<NonNullable<SubscriptionProductPage["cardTag"]>>(subscriptionEditing?.cardTag ?? "Subscribe & save");
  const [deliveryCharge, setDeliveryCharge] = useState(textOf(subscriptionEditing?.oneTimeDeliveryCharge ?? 30));
  const [cutoffHour, setCutoffHour] = useState(textOf(subscriptionEditing?.orderCutoffHour ?? 21));
  const [deliveryByTime, setDeliveryByTime] = useState(subscriptionEditing?.deliveryByTime ?? "7 AM");
  const [subscriberSince, setSubscriberSince] = useState(subscriptionEditing?.review.subscriberSince ?? "");

  function chooseKind() {
    // Sensible starting values for the chosen kind
    if (kind === "subscription") {
      setMiddleStep({ title: "Milked at 5 AM", detail: "Chilled within minutes" });
      setBadgeColour("grey");
    } else {
      setMiddleStep({ title: "Packed fresh", detail: "This week’s batch" });
    }
    setProblems([]);
    setStep("details");
  }

  // Chosen pictures: background removed, shadow below, saved as a see-through WebP (see processPictureFile)
  async function addPictures(files: FileList | null) {
    if (!files || files.length === 0) return;
    const chosenFiles = Array.from(files).slice(0, 2);
    setPictureStatus("Removing the background and adding a shadow below…");
    try {
      const chosen = await Promise.all(chosenFiles.map((file) => processPictureFile(file, removesOldShadow)));
      setPictures((current) => [...current, ...chosen].slice(0, 2));
      if (chosen.length + pictures.length > 1) setPictureShape("pair");
      // A new picture is sized automatically, like the other products
      else if (pictureShape === "keep") setPictureShape("auto");
      // The picture carries its own shadow below, so no extra shadow around it
      setHasPictureShadow(false);
      setPictureStatus("Ready: background removed, shadow below, saved as a see-through WebP. Check the preview below.");
    } catch (error) {
      setPictureStatus("");
      showToast(error instanceof Error && error.message === PICTURE_TOO_BIG_MESSAGE ? PICTURE_TOO_BIG_MESSAGE : "That file is not a picture");
    }
  }

  function buildPicturesAndFit(): { pictureList: ProductPicture[]; fit: PictureFit } {
    const fromAddress = pictureAddress.trim() ? [{ imageSource: pictureAddress.trim(), imageWidth: 1000, imageHeight: 1000 }] : [];
    const chosen = [...pictures, ...fromAddress].slice(0, 2);
    const pictureList = chosen.map((picture, index) => ({
      ...picture,
      alt:
        "alt" in picture && typeof picture.alt === "string" && editingPage
          ? picture.alt
          : `${name}${chosen.length > 1 ? ` (picture ${index + 1})` : ""}`,
    }));
    const fit =
      pictureShape === "keep" && editingPage
        ? editingPage.pictureFit
        : pictureList.length > 1 || pictureShape === "pair"
          ? { widthPercent: 34, heightPercent: 84 }
          : pictureShape === "auto" || !PICTURE_SHAPES.some((shape) => shape.value === pictureShape)
            ? fitForPicture(pictureList[0]?.imageWidth ?? 1000, pictureList[0]?.imageHeight ?? 1000)
            : (PICTURE_SHAPES.find((shape) => shape.value === pictureShape) ?? PICTURE_SHAPES[0]).fit;
    return { pictureList, fit };
  }

  function buildDeliverySteps(): DeliveryStep[] {
    const [firstStep, middle, last] = editingPage?.deliverySteps ?? [];
    return [
      firstStep ?? orderByNineStep,
      { icon: middle?.icon ?? (kind === "subscription" ? "milk-drop" : "box"), title: middleStep.title || "Packed fresh", detail: middleStep.detail },
      { ...(last ?? atYourDoorStep), detail: lastStepDetail || atYourDoorStep.detail },
    ];
  }

  // Everything the website needs, checked; problems are listed at the top of the form
  function save(): boolean {
    // Inside a card's pop-up: the card's name and photo are the page's
    const pageName = embedded ? embedded.name : name;
    const found: string[] = [];
    if (!pageName.trim()) found.push("Product name");
    // (The address is made from the name, so it is only listed when a name is there)
    if (!slug && pageName.trim()) found.push("Page address");
    else if (!isEditing && isProductSlugTaken(slug)) found.push(`Page address: /products/${slug} is already used`);
    const built = buildPicturesAndFit();
    const embeddedPhoto = embedded?.photo;
    const isPhotoChangedInCard = Boolean(embeddedPhoto && embeddedPhoto.imageSource !== built.pictureList[0]?.imageSource);
    const pictureList =
      embeddedPhoto && isPhotoChangedInCard
        ? [{ ...embeddedPhoto, alt: pageName.trim() }, ...built.pictureList.slice(1)]
        : built.pictureList;
    // A photo changed in the card's pop-up is sized automatically too
    const fit =
      embeddedPhoto && isPhotoChangedInCard && pictureList.length === 1
        ? fitForPicture(embeddedPhoto.imageWidth, embeddedPhoto.imageHeight)
        : built.fit;
    if (pictureList.length === 0) found.push("A picture (upload one or type its address)");
    // Product pictures are WebP only (fast to load); uploads are turned into WebP automatically
    if (pictureAddress.trim() && !/\.webp(\?.*)?$/i.test(pictureAddress.trim())) {
      found.push("Picture address: a .webp picture (or upload the photo, it is turned into WebP)");
    }

    const base = {
      slug,
      // The All products filter: kept on Edit; on Add, from the Products & pricing category
      // (A category the admin added shows under "Others" in the website's filters)
      shopCategory: editingPage?.shopCategory ?? SHOP_CATEGORY_FROM_PANEL_CATEGORY[embedded?.category ?? category] ?? "Others",
      status,
      name: pageName.trim(),
      tagline: tagline.trim(),
      description: description.trim(),
      badge: { text: badgeText.trim(), colour: badgeColour },
      rating: { score: ratingScore.trim(), count: ratingCount.trim() },
      highlights: highlightsText.split(",").map((highlight) => highlight.trim()).filter(Boolean),
      pictures: pictureList,
      pictureFit: fit,
      hasPictureShadow,
      deliverySteps: buildDeliverySteps(),
      // Its own row order, or none (the shared list)
      productRowOverride: hasOwnProductRow && ownProductRow.some(Boolean) ? ownProductRow.filter(Boolean) : undefined,
    };

    let page: ProductPage | null = null;
    if (kind === "one-time") {
      const filledPacks = packs.filter((pack) => pack.label.trim() || pack.price.trim());
      if (filledPacks.length === 0) found.push("At least one pack size with a price");
      const builtPacks: OneTimePack[] = filledPacks.map((pack, index) => {
        if (!pack.label.trim() || !(Number(pack.price) > 0)) found.push(`Pack ${index + 1}: size name and price`);
        if (priceShownPer !== "item-count" && !(Number(pack.size) > 0)) found.push(`Pack ${index + 1}: size as a number (for the price per ${priceShownPer})`);
        return {
          packId: toProductSlug(pack.label) || `pack-${index + 1}`,
          label: pack.label.trim(),
          size: Number(pack.size) || 1,
          price: Number(pack.price) || 0,
          originalPrice: Number(pack.originalPrice) > 0 ? Number(pack.originalPrice) : undefined,
          tag: pack.tag || undefined,
          itemCount: Number(pack.itemCount) > 0 ? Number(pack.itemCount) : undefined,
        };
      });
      if (priceShownPer === "item-count" && !itemLabel.trim()) found.push("What the items are called (e.g. idlis)");
      const breakdownChoice = PRICE_BREAKDOWN_CHOICES.find((choice) => choice.value === priceShownPer) ?? PRICE_BREAKDOWN_CHOICES[0];
      // Editing with the same unit keeps how the page rounds it (e.g. ghee's whole rupees, paneer's 50 paise)
      const keptBreakdown = oneTimeEditing?.priceBreakdown.kind === "per-unit" && oneTimeEditing.priceBreakdown.unitLabel === priceShownPer ? oneTimeEditing.priceBreakdown : null;
      const oneTimePage: OneTimeProductPage = {
        fastSellingCards: defaultFastSellingCards,
        ...oneTimeEditing,
        ...base,
        kind: "one-time",
        ratingNote: ratingNote.trim(),
        packs: builtPacks,
        defaultPackId: builtPacks[Math.min(defaultPackIndex, builtPacks.length - 1)]?.packId ?? "",
        priceBreakdown:
          priceShownPer === "item-count"
            ? { kind: "item-count", itemLabel: itemLabel.trim(), taxNote: taxNote.trim() }
            : {
                kind: "per-unit",
                unitLabel: breakdownChoice.value,
                unitSize: breakdownChoice.unitSize,
                headlineDecimals: keptBreakdown?.headlineDecimals ?? 2,
                cardRounding: keptBreakdown?.cardRounding ?? "whole",
                taxNote: taxNote.trim(),
              },
        cartPackWord: packWord.trim() || "pack",
        quantityWord: oneTimeEditing && oneTimeEditing.cartPackWord === packWord.trim() ? oneTimeEditing.quantityWord : { one: packWord.trim() || "pack", many: `${packWord.trim() || "pack"}s` },
        note: { text: noteText.trim(), tone: noteTone },
        freeDelivery: freeDeliveryKind === "always" ? { kind: "always" } : { kind: "from", amount: FREE_DELIVERY_FROM },
        review: { quote: reviewQuote.trim(), name: reviewName.trim(), area: reviewArea.trim() },
        // Rows with both a label and a value (empty ones are left out of the page)
        productInformation: informationRows.map((row) => ({ label: row.label.trim(), value: row.value.trim() })).filter((row) => row.label && row.value),
        nutritionFacts: nutritionRows.map((row) => ({ label: row.label.trim(), value: row.value.trim() })).filter((row) => row.label && row.value),
        nutritionBasis: nutritionBasis.trim(),
      };
      page = oneTimePage;
    } else {
      if (!(Number(price) > 0)) found.push(`Price per ${unitName || "unit"}`);
      const builtPlans: SubscriptionPlanSetting[] = plans
        .filter((plan) => plan.label.trim())
        .map((plan, index) => ({
          planId: toProductSlug(plan.label),
          label: plan.label.trim(),
          months: Number(plan.months) || 0,
          days: Number(plan.days) || 0,
          percentOff: Number(plan.percentOff) || 0,
          tag: plan.tag || undefined,
          // The design shows "1L daily" on the first (shortest) plan and "you save ₹…" on the others
          showsSavingInDetails: index > 0,
        }));
      if (builtPlans.length === 0 || builtPlans.some((plan) => plan.days <= 0)) found.push("Plans: each needs a name and a number of days");
      const subscriptionPage: SubscriptionProductPage = {
        fastSellingCards: defaultFastSellingCards,
        subscriptionFastSellingCards: defaultSubscriptionFastSellingCards,
        ...subscriptionEditing,
        ...base,
        kind: "subscription",
        timingsStripText: timingsStripText.trim(),
        price: Number(price) || 0,
        originalPrice: Number(originalPrice) > 0 ? Number(originalPrice) : undefined,
        hasHalfLitreBottle,
        halfLitrePrice: hasHalfLitreBottle && Number(halfLitrePrice) > 0 ? Number(halfLitrePrice) : undefined,
        unitName: unitName.trim(),
        unitShort: unitShort.trim(),
        packShort: packShort.trim(),
        packSize: packSize.trim(),
        billLabel: billLabel.trim() || name.trim(),
        itemWord:
          subscriptionEditing && subscriptionEditing.itemWord.one === itemWord.trim()
            ? subscriptionEditing.itemWord
            : { one: itemWord.trim() || "bottle", many: `${itemWord.trim() || "bottle"}s` },
        homesNote: { bold: homesBold.trim(), rest: homesRest.trim() },
        plans: builtPlans,
        defaultPlanId: builtPlans[Math.min(defaultPlanIndex, builtPlans.length - 1)]?.planId ?? "",
        cardTag,
        oneTimeDeliveryCharge: Number(deliveryCharge) || 0,
        orderCutoffHour: Math.min(23, Math.max(0, Number(cutoffHour) || 21)),
        deliveryByTime: deliveryByTime.trim(),
        productInformation: informationRows.map((row) => ({ label: row.label.trim(), value: row.value.trim() })).filter((row) => row.label && row.value),
        nutritionFacts: nutritionRows.map((row) => ({ label: row.label.trim(), value: row.value.trim() })).filter((row) => row.label && row.value),
        nutritionBasis: nutritionBasis.trim(),
        review: { quote: reviewQuote.trim(), name: reviewName.trim(), area: reviewArea.trim(), subscriberSince: subscriberSince.trim() },
      };
      page = subscriptionPage;
    }

    // Inside a card's pop-up for someone who is not the owner: the prices must stay as they were
    if (embedded && embedded.canChangePrices === false && page && editingPage) {
      const priceKey = (onePage: ProductPage) =>
        onePage.kind === "one-time"
          ? onePage.packs.map((pack) => `${pack.label}:${pack.price}:${pack.originalPrice ?? ""}`).join("|")
          : `${onePage.price}:${onePage.originalPrice ?? ""}:${onePage.halfLitrePrice ?? ""}:${onePage.plans.map((plan) => plan.percentOff).join(",")}`;
      if (priceKey(page) !== priceKey(editingPage)) found.push("Prices are changed only by the owner. Put the prices back as they were.");
    }

    if (found.length > 0 || !page) {
      setProblems(found);
      return false;
    }

    /*
      The product's card(s) on Products & pricing: made for a product added here, and made again on Edit
      (the old ones go). The starting products keep their own cards. An uploaded picture stays on the page
      only, to keep the browser's storage small.
    */
    const savedPage: ProductPage = page;
    let panelCardIds: string[] | undefined = editingPage?.panelCardIds;
    // Inside a card's pop-up the pop-up saves the card itself, so the cards are left as they are
    if (!embedded && !isStartingProductPage(savedPage.slug)) {
      editingPage?.panelCardIds?.forEach((cardId) => removeProduct(cardId));
      const cardPicture = pictureList[0] && !pictureList[0].imageSource.startsWith("data:") ? pictureList[0] : undefined;
      const cardPictureFields = cardPicture
        ? { imageSource: cardPicture.imageSource, imageWidth: cardPicture.imageWidth, imageHeight: cardPicture.imageHeight }
        : {};
      if (savedPage.kind === "one-time") {
        const { name: productName, cartPackWord } = savedPage;
        panelCardIds = savedPage.packs.map(
          (pack) =>
            addProduct({ name: productName, category, packSize: `${pack.label} ${cartPackWord}`, price: pack.price, originalPrice: pack.originalPrice, stock: "in", isVisible: status === "published", ...cardPictureFields }).productId,
        );
      } else {
        const defaultPlan = savedPage.plans.find((plan) => plan.planId === savedPage.defaultPlanId) ?? savedPage.plans[0];
        panelCardIds = [
          addProduct({
            name: savedPage.name,
            category,
            packSize: savedPage.packSize,
            price: savedPage.price,
            originalPrice: savedPage.originalPrice,
            subscriptionPrice: defaultPlan ? Math.round(savedPage.price * (1 - defaultPlan.percentOff / 100)) : undefined,
            stock: "in",
            isVisible: status === "published",
            ...cardPictureFields,
          }).productId,
        ];
      }
    }

    const pageToSave = { ...savedPage, panelCardIds };
    const isSaved = isEditing ? updateProductPage(pageToSave) : addProductPage(pageToSave);
    if (!isSaved) {
      setProblems(["The browser could not save it: the pictures are too big for its storage. Use smaller pictures or type a picture address (e.g. /images/products/…)."]);
      return false;
    }

    if (embedded) {
      setProblems([]);
      embedded.onSaved?.(pageToSave);
      return true;
    }
    setSavedSlug(slug);
    setStep("saved");
    showToast(`${savedPage.name} ${isEditing ? "updated" : "added"} · /products/${slug}`);
    return true;
  }

  // Inside a card's pop-up: hand the latest save to the pop-up (its Save changes calls it)
  useEffect(() => {
    embedded?.registerSave(save);
  });

  // ---------- Step 1: what kind of product (Add only) ----------
  if (step === "kind") {
    return (
      <AdminDialog title="Add product" onClose={onClose} onSubmit={chooseKind} submitLabel="Next">
        <fieldset className={styles["admin-product-page-kind-choices"]}>
          <legend className={styles["admin-product-page-section-title"]}>What kind of product is it?</legend>
          {(
            [
              { value: "subscription", title: "Subscription", detail: "Delivered every morning on a plan (3 / 6 / 12 months), with a one-time option too. Like milk." },
              { value: "one-time", title: "One-time purchase", detail: "Bought when needed, in pack sizes (e.g. 250 ml / 500 ml / 1 litre). Like ghee, paneer or atta." },
            ] as const
          ).map((choice) => (
            <label key={choice.value} className={`${styles["admin-product-page-kind-choice"]} ${kind === choice.value ? styles["admin-product-page-kind-choice-chosen"] : ""}`}>
              <input type="radio" name="product-kind" value={choice.value} checked={kind === choice.value} onChange={() => setKind(choice.value)} />
              <span>
                <strong>{choice.title}</strong>
                <span>{choice.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <AdminDialogField label="Category on Products & pricing" isWide>
          <CategoryPicker value={category} onChange={setCategory} />
        </AdminDialogField>
      </AdminDialog>
    );
  }

  // ---------- Step 3: saved ----------
  if (step === "saved") {
    const pageAddress = `/products/${savedSlug}${status === "draft" ? "?preview=1" : ""}`;
    return (
      <AdminDialog title={isEditing ? "Product updated" : "Product added"} onClose={onClose} onSubmit={onClose} submitLabel="Done">
        <div className={styles["admin-product-page-saved"]}>
          <p>
            <strong>{name}</strong> {isEditing ? "is updated" : "has its page"}
            {status === "draft" ? " (draft: only the preview shows it)" : ""}:
          </p>
          <a href={pageAddress} target="_blank" rel="noreferrer" className={styles["admin-product-page-saved-link"]}>
            {status === "draft" ? "Preview" : "Open"} /products/{savedSlug}
          </a>
          <p className={styles["admin-product-page-hint"]}>
            Until the database (Supabase) is connected, this is saved in this browser only, so customers do not see it yet.
          </p>
        </div>
      </AdminDialog>
    );
  }

  // ---------- Step 2: the form for the chosen kind (numbered, named sections) ----------
  const isOneTime = kind === "one-time";
  const formTitle = isEditing ? `Edit ${editingPage?.name}` : isOneTime ? "Add one-time product" : "Add subscription product";
  let sectionNumber = 0;
  const nextSection = () => ++sectionNumber;
  const setPack = (index: number, changes: Partial<PackRow>) => setPacks(packs.map((row, rowIndex) => (rowIndex === index ? { ...row, ...changes } : row)));
  const setPlan = (index: number, changes: Partial<PlanRow>) => setPlans(plans.map((row, rowIndex) => (rowIndex === index ? { ...row, ...changes } : row)));

  // Inside a card's pop-up: the sections sit in a plain box; otherwise in the panel's pop-up dialog
  // (a plain function, not a component, so typing never resets the fields)
  const formFrame = (children: ReactNode) =>
    embedded ? (
      <div className={styles["admin-product-page-embedded"]}>
        <h3 className={styles["admin-product-page-embedded-title"]}>Website page</h3>
        <div className={styles["admin-product-page-embedded-fields"]}>{children}</div>
      </div>
    ) : (
      <AdminDialog title={formTitle} onClose={onClose} onSubmit={save} submitLabel={isEditing ? "Save changes" : "Save product"}>
        {children}
      </AdminDialog>
    );

  return formFrame(
    <>
      <FormSection number={nextSection()} title="Basic details">
        {/* Inside a card's pop-up the card's Product name is used */}
        {!embedded && (
        <AdminDialogField label="Product name *">
          <input className={adminInputClassName} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ragi Flour" />
        </AdminDialogField>
        )}
        {isEditing ? (
          // Inside a card's pop-up the address shows once, as the "Open /products/…" link above
          !embedded && (
            <AdminDialogField label="Page address (stays the same)">
              <input className={adminInputClassName} value={`/products/${slug}`} readOnly />
            </AdminDialogField>
          )
        ) : (
          <AdminDialogField label={`Page address: /products/${slug || "…"}`}>
            <input className={adminInputClassName} value={slugTyped} onChange={(event) => setSlugTyped(event.target.value)} placeholder="made from the name" />
          </AdminDialogField>
        )}
        <AdminDialogField label="Tagline (under the name)" isWide>
          <input className={adminInputClassName} value={tagline} onChange={(event) => setTagline(event.target.value)} placeholder="Traditional Chakki-Ground Goodness" />
        </AdminDialogField>
        <AdminDialogField label="Description" isWide>
          <textarea className={`${adminInputClassName} ${styles["admin-product-page-textarea"]}`} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A short paragraph about the product" />
        </AdminDialogField>
      </FormSection>

      <FormSection number={nextSection()} title="Badge, rating & highlights">
        <AdminDialogField label="Badge text (above the name)">
          <input className={adminInputClassName} value={badgeText} onChange={(event) => setBadgeText(event.target.value)} placeholder="Fresh daily" />
        </AdminDialogField>
        <AdminDialogField label="Badge colour">
          <select className={adminInputClassName} value={badgeColour} onChange={(event) => setBadgeColour(event.target.value as BadgeColour)}>
            {BADGE_COLOURS.map((colour) => (
              <option key={colour.value} value={colour.value}>
                {colour.label}
              </option>
            ))}
          </select>
        </AdminDialogField>
        <AdminDialogField label="Rating (out of 5)">
          <input className={adminInputClassName} value={ratingScore} onChange={(event) => setRatingScore(event.target.value)} placeholder="4.8" />
        </AdminDialogField>
        <AdminDialogField label="Number of ratings">
          <input className={adminInputClassName} value={ratingCount} onChange={(event) => setRatingCount(event.target.value)} placeholder="(1.5K)" />
        </AdminDialogField>
        {isOneTime ? (
          <AdminDialogField label="Green note after the rating" isWide>
            <input className={adminInputClassName} value={ratingNote} onChange={(event) => setRatingNote(event.target.value)} placeholder="Freshly Milled" />
          </AdminDialogField>
        ) : (
          <>
            <AdminDialogField label="Homes (bold)">
              <input className={adminInputClassName} value={homesBold} onChange={(event) => setHomesBold(event.target.value)} placeholder="9.3k+ homes" />
            </AdminDialogField>
            <AdminDialogField label="…after it">
              <input className={adminInputClassName} value={homesRest} onChange={(event) => setHomesRest(event.target.value)} placeholder="get it every morning" />
            </AdminDialogField>
          </>
        )}
        <AdminDialogField label="Highlights (the ✓ chips, comma between them)" isWide>
          <input className={adminInputClassName} value={highlightsText} onChange={(event) => setHighlightsText(event.target.value)} placeholder="Stone-ground, 100% whole wheat, No maida, Lab-tested" />
        </AdminDialogField>
      </FormSection>

      {/* Inside a card's pop-up the card's photo is the page's photo (no separate pictures) */}
      {!embedded && (
      <FormSection number={nextSection()} title="Pictures">
        {pictures.length > 0 && (
          <div className={styles["admin-product-page-picture-previews"]}>
            {pictures.map((picture, index) => (
              <span key={index} className={styles["admin-product-page-picture-preview"]}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a chosen or saved product picture, shown small */}
                <img src={picture.imageSource} alt="" />
                <button type="button" onClick={() => setPictures((current) => current.filter((_, pictureIndex) => pictureIndex !== index))}>
                  Remove
                </button>
              </span>
            ))}
          </div>
        )}
        <label className={`${styles["admin-product-page-checkbox"]} ${styles["admin-product-page-checkbox-wide"]}`}>
          <input type="checkbox" checked={removesOldShadow} onChange={(event) => setRemovesOldShadow(event.target.checked)} />
          Also remove the photo&rsquo;s grey floor shadow (untick for white products like a milk bottle, then upload again)
        </label>
        <AdminDialogField label={pictures.length > 0 ? "Upload another or a new one" : "Upload (1, or 2 side by side)"} isWide>
          <input className={adminInputClassName} type="file" accept="image/*" multiple onChange={(event) => addPictures(event.target.files)} />
        </AdminDialogField>
        {pictureStatus && (
          <p className={styles["admin-product-page-picture-status"]} role="status">
            {pictureStatus}
          </p>
        )}
        <p className={styles["admin-product-page-hint"]}>
          Any picture (JPG, PNG, WebP…, up to {PICTURE_UPLOAD_LIMIT_MB} MB) is prepared automatically: the background is removed, a soft shadow is added below the
          product, and it is saved as a high-quality see-through WebP, so the gold ring and green card show around it.
        </p>
        <AdminDialogField label="…or picture address" isWide>
          <input className={adminInputClassName} value={pictureAddress} onChange={(event) => setPictureAddress(event.target.value)} placeholder="/images/products/ragi-flour-pack.webp" />
        </AdminDialogField>
        <AdminDialogField label="Picture shape">
          <select className={adminInputClassName} value={pictureShape} onChange={(event) => setPictureShape(event.target.value)}>
            {isEditing && <option value="keep">Keep as it is now</option>}
            <option value="auto">Automatic (sized like the other products)</option>
            {PICTURE_SHAPES.map((shape) => (
              <option key={shape.value} value={shape.value}>
                {shape.label}
              </option>
            ))}
            <option value="pair">Two side by side</option>
          </select>
        </AdminDialogField>
      </FormSection>
      )}

      {isOneTime ? (
        <>
          <FormSection number={nextSection()} title="Pack sizes & prices" lockedNote={pricesLockedNote}>
            <div className={styles["admin-product-page-rows"]}>
              {/* Phones: one line (the boxes wrap two a row); larger screens: each label above its own box */}
              <span className={`${styles["admin-product-page-row-heading"]} ${styles["admin-product-page-row-heading-phone"]}`}>
                Size name · Size · Price ₹ · Old price ₹ · Tag{priceShownPer === "item-count" ? " · Items" : ""}
              </span>
              <div className={`${styles["admin-product-page-pack-row"]} ${styles["admin-product-page-row-labels"]}`} aria-hidden="true">
                <span>Size name</span>
                <span>Size</span>
                <span>Price ₹</span>
                <span>Old price ₹</span>
                <span>Tag</span>
                {priceShownPer === "item-count" && <span>Items</span>}
                <span className={styles["admin-product-page-row-labels-spacer"]} />
              </div>
              {packs.map((pack, index) => (
                <div key={index} className={styles["admin-product-page-pack-row"]}>
                  <input className={adminInputClassName} aria-label={`Pack ${index + 1} size name`} value={pack.label} onChange={(event) => setPack(index, { label: event.target.value })} placeholder="500 g" />
                  <input className={adminInputClassName} aria-label={`Pack ${index + 1} size`} inputMode="decimal" value={pack.size} onChange={(event) => setPack(index, { size: event.target.value })} placeholder="500" />
                  <input className={adminInputClassName} aria-label={`Pack ${index + 1} price`} inputMode="decimal" value={pack.price} onChange={(event) => setPack(index, { price: event.target.value })} placeholder="349" />
                  <input className={adminInputClassName} aria-label={`Pack ${index + 1} old price`} inputMode="decimal" value={pack.originalPrice} onChange={(event) => setPack(index, { originalPrice: event.target.value })} placeholder="—" />
                  <select className={adminInputClassName} aria-label={`Pack ${index + 1} tag`} value={pack.tag} onChange={(event) => setPack(index, { tag: event.target.value as PackRow["tag"] })}>
                    <option value="">No tag</option>
                    <option>Best value</option>
                    <option>Most popular</option>
                  </select>
                  {priceShownPer === "item-count" && (
                    <input className={adminInputClassName} aria-label={`Pack ${index + 1} items`} inputMode="numeric" value={pack.itemCount} onChange={(event) => setPack(index, { itemCount: event.target.value })} placeholder="20" />
                  )}
                  <button type="button" className={styles["admin-product-page-remove-button"]} aria-label={`Remove pack ${index + 1}`} onClick={() => setPacks(packs.length > 1 ? packs.filter((_, rowIndex) => rowIndex !== index) : [emptyPack()])}>
                    ×
                  </button>
                </div>
              ))}
              {packs.length < 5 && (
                <button type="button" className={styles["admin-product-page-add-button"]} onClick={() => setPacks([...packs, emptyPack()])}>
                  + Add pack size
                </button>
              )}
            </div>
            <AdminDialogField label="Pack shown first">
              <select className={adminInputClassName} value={defaultPackIndex} onChange={(event) => setDefaultPackIndex(Number(event.target.value))}>
                {packs.map((pack, index) => (
                  <option key={index} value={index}>
                    {pack.label || `Pack ${index + 1}`}
                  </option>
                ))}
              </select>
            </AdminDialogField>
            <AdminDialogField label="One pack is a (jar, pack, pouch)">
              <input className={adminInputClassName} value={packWord} onChange={(event) => setPackWord(event.target.value)} />
            </AdminDialogField>
          </FormSection>

          <FormSection number={nextSection()} title="Price display, delivery & offers">
            <AdminDialogField label="Price shown per">
              <select className={adminInputClassName} value={priceShownPer} onChange={(event) => setPriceShownPer(event.target.value)}>
                {PRICE_BREAKDOWN_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </AdminDialogField>
            {priceShownPer === "item-count" ? (
              <AdminDialogField label="Items are called">
                <input className={adminInputClassName} value={itemLabel} onChange={(event) => setItemLabel(event.target.value)} placeholder="idlis" />
              </AdminDialogField>
            ) : (
              <AdminDialogField label="Tax note">
                <input className={adminInputClassName} value={taxNote} onChange={(event) => setTaxNote(event.target.value)} />
              </AdminDialogField>
            )}
            {priceShownPer === "item-count" && (
              <AdminDialogField label="Tax note">
                <input className={adminInputClassName} value={taxNote} onChange={(event) => setTaxNote(event.target.value)} />
              </AdminDialogField>
            )}
            {/* Free delivery is for the whole order (everything in the cart), from one amount for all products */}
            <AdminDialogField label="Free delivery">
              <select className={adminInputClassName} value={freeDeliveryKind} onChange={(event) => setFreeDeliveryKind(event.target.value as "from" | "always")}>
                <option value="from">On whole orders from ₹{FREE_DELIVERY_FROM}</option>
                <option value="always">Always free</option>
              </select>
            </AdminDialogField>
            <AdminDialogField label="Line under the pack sizes" isWide>
              <input className={adminInputClassName} value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Milled this week · resealable zip pouch" />
            </AdminDialogField>
            <AdminDialogField label="That line is">
              <select className={adminInputClassName} value={noteTone} onChange={(event) => setNoteTone(event.target.value as "fresh" | "warning")}>
                <option value="fresh">Freshness (green dot)</option>
                <option value="warning">Low stock warning (red)</option>
              </select>
            </AdminDialogField>
          </FormSection>
        </>
      ) : (
        <>
          <FormSection number={nextSection()} title="Price & units" lockedNote={pricesLockedNote}>
            <AdminDialogField label={`Price per ${unitName || "unit"} ₹ *`}>
              <input className={adminInputClassName} inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="95" />
            </AdminDialogField>
            <AdminDialogField label="Old price ₹ (crossed out)">
              <input className={adminInputClassName} inputMode="decimal" value={originalPrice} onChange={(event) => setOriginalPrice(event.target.value)} placeholder="110" />
            </AdminDialogField>
            {/* Milk: a 500 ml bottle beside the 1 litre one, with its own price or half the litre price */}
            <AdminDialogField label="500 ml bottle">
              <select
                className={adminInputClassName}
                value={hasHalfLitreBottle ? "yes" : "no"}
                onChange={(event) => setHasHalfLitreBottle(event.target.value === "yes")}
              >
                <option value="yes">Yes, sold in 500 ml too</option>
                <option value="no">No, only this size</option>
              </select>
            </AdminDialogField>
            {hasHalfLitreBottle && (
              <AdminDialogField label="500 ml price ₹ (empty: half the price)">
                <input
                  className={adminInputClassName}
                  inputMode="decimal"
                  value={halfLitrePrice}
                  onChange={(event) => setHalfLitrePrice(event.target.value)}
                  placeholder={Number(price) > 0 ? String(Math.ceil(Number(price) / 2)) : "53"}
                />
              </AdminDialogField>
            )}
            <AdminDialogField label="Unit (₹95 / litre)">
              <input className={adminInputClassName} value={unitName} onChange={(event) => setUnitName(event.target.value)} />
            </AdminDialogField>
            <AdminDialogField label="Unit short (1L daily)">
              <input className={adminInputClassName} value={unitShort} onChange={(event) => setUnitShort(event.target.value)} />
            </AdminDialogField>
            <AdminDialogField label="One delivery is">
              <input className={adminInputClassName} value={packSize} onChange={(event) => setPackSize(event.target.value)} />
            </AdminDialogField>
            <AdminDialogField label="Short (2 × 1 L bottles)">
              <input className={adminInputClassName} value={packShort} onChange={(event) => setPackShort(event.target.value)} />
            </AdminDialogField>
            <AdminDialogField label="Item word (bottle)">
              <input className={adminInputClassName} value={itemWord} onChange={(event) => setItemWord(event.target.value)} />
            </AdminDialogField>
            <AdminDialogField label="Bill line name (Milk)">
              <input className={adminInputClassName} value={billLabel} onChange={(event) => setBillLabel(event.target.value)} placeholder={name || "Milk"} />
            </AdminDialogField>
          </FormSection>

          <FormSection number={nextSection()} title="Subscription plans" lockedNote={pricesLockedNote}>
            <div className={styles["admin-product-page-rows"]}>
              <span className={`${styles["admin-product-page-row-heading"]} ${styles["admin-product-page-row-heading-phone"]}`}>
                Plan · Months · Days · % off · Tag
              </span>
              <div className={`${styles["admin-product-page-plan-row"]} ${styles["admin-product-page-row-labels"]}`} aria-hidden="true">
                <span>Plan</span>
                <span>Months</span>
                <span>Days</span>
                <span>% off</span>
                <span>Tag</span>
              </div>
              {plans.map((plan, index) => (
                <div key={index} className={styles["admin-product-page-plan-row"]}>
                  <input className={adminInputClassName} aria-label={`Plan ${index + 1} name`} value={plan.label} onChange={(event) => setPlan(index, { label: event.target.value })} />
                  <input className={adminInputClassName} aria-label={`Plan ${index + 1} months`} inputMode="numeric" value={plan.months} onChange={(event) => setPlan(index, { months: event.target.value })} />
                  <input className={adminInputClassName} aria-label={`Plan ${index + 1} days`} inputMode="numeric" value={plan.days} onChange={(event) => setPlan(index, { days: event.target.value })} />
                  <input className={adminInputClassName} aria-label={`Plan ${index + 1} percent off`} inputMode="decimal" value={plan.percentOff} onChange={(event) => setPlan(index, { percentOff: event.target.value })} />
                  <select className={adminInputClassName} aria-label={`Plan ${index + 1} tag`} value={plan.tag} onChange={(event) => setPlan(index, { tag: event.target.value as PlanRow["tag"] })}>
                    <option value="">No tag</option>
                    <option>Best value</option>
                    <option>Most popular</option>
                  </select>
                </div>
              ))}
            </div>
            <AdminDialogField label="Plan chosen first">
              <select className={adminInputClassName} value={defaultPlanIndex} onChange={(event) => setDefaultPlanIndex(Number(event.target.value))}>
                {plans.map((plan, index) => (
                  <option key={index} value={index}>
                    {plan.label || `Plan ${index + 1}`}
                  </option>
                ))}
              </select>
            </AdminDialogField>
            <AdminDialogField label="Tag on product cards (landing page, All products)">
              <select className={adminInputClassName} value={cardTag} onChange={(event) => setCardTag(event.target.value as typeof cardTag)}>
                <option value="Subscribe & save">Subscribe &amp; save</option>
                <option value="Best value">Best value</option>
                <option value="Most popular">Most popular</option>
                <option value="">No tag</option>
              </select>
            </AdminDialogField>
          </FormSection>

          <FormSection number={nextSection()} title="Delivery & timings">
            <AdminDialogField label="One-time delivery charge ₹">
              <input className={adminInputClassName} inputMode="decimal" value={deliveryCharge} onChange={(event) => setDeliveryCharge(event.target.value)} />
            </AdminDialogField>
            <AdminDialogField label="Orders close at (hour, 0–23)">
              <input className={adminInputClassName} inputMode="numeric" value={cutoffHour} onChange={(event) => setCutoffHour(event.target.value)} />
            </AdminDialogField>
            <AdminDialogField label="Delivered by">
              <input className={adminInputClassName} value={deliveryByTime} onChange={(event) => setDeliveryByTime(event.target.value)} />
            </AdminDialogField>
            <AdminDialogField label="Green strip above the menu bar" isWide>
              <input className={adminInputClassName} value={timingsStripText} onChange={(event) => setTimingsStripText(event.target.value)} />
            </AdminDialogField>
          </FormSection>
        </>
      )}

      <FormSection number={nextSection()} title="Delivery steps (Order by 9 PM → … → At your door)">
        <AdminDialogField label="Middle step">
          <input className={adminInputClassName} value={middleStep.title} onChange={(event) => setMiddleStep({ ...middleStep, title: event.target.value })} placeholder="Packed fresh" />
        </AdminDialogField>
        <AdminDialogField label="…below it">
          <input className={adminInputClassName} value={middleStep.detail} onChange={(event) => setMiddleStep({ ...middleStep, detail: event.target.value })} placeholder="This week’s batch" />
        </AdminDialogField>
        <AdminDialogField label="At your door (when)">
          <input className={adminInputClassName} value={lastStepDetail} onChange={(event) => setLastStepDetail(event.target.value)} />
        </AdminDialogField>
      </FormSection>

      <FormSection number={nextSection()} title="Customer review">
        <AdminDialogField label="Customer name">
          <input className={adminInputClassName} value={reviewName} onChange={(event) => setReviewName(event.target.value)} placeholder="Kavya P." />
        </AdminDialogField>
        <AdminDialogField label="Area">
          <input className={adminInputClassName} value={reviewArea} onChange={(event) => setReviewArea(event.target.value)} placeholder="Malleshwaram" />
        </AdminDialogField>
        {!isOneTime && (
          <AdminDialogField label="Subscriber since" isWide>
            <input className={adminInputClassName} value={subscriberSince} onChange={(event) => setSubscriberSince(event.target.value)} placeholder="Subscriber for 8 months" />
          </AdminDialogField>
        )}
        <AdminDialogField label="Review text (leave empty for no review box)" isWide>
          <textarea className={`${adminInputClassName} ${styles["admin-product-page-textarea"]}`} value={reviewQuote} onChange={(event) => setReviewQuote(event.target.value)} />
        </AdminDialogField>
      </FormSection>

      <>
          <FormSection number={nextSection()} title="Product information">
            <InformationRowsEditor rows={informationRows} onChange={setInformationRows} groupLabel="Product information" addLabel="Add information row" />
          </FormSection>

          <FormSection number={nextSection()} title="Nutrition facts">
            <AdminDialogField label="Values are per" isWide>
              <input className={adminInputClassName} value={nutritionBasis} onChange={(event) => setNutritionBasis(event.target.value)} />
            </AdminDialogField>
            <InformationRowsEditor rows={nutritionRows} onChange={setNutritionRows} groupLabel="Nutrition" addLabel="Add nutrition row" />
          </FormSection>
      </>

      <FormSection number={nextSection()} title={`Product row on this page (${noodlesPageOf(slug) ? "You may also like" : "Fast selling products"})`}>
        <AdminDialogField label="Products and order" isWide>
          <select
            className={adminInputClassName}
            value={hasOwnProductRow ? "own" : "shared"}
            onChange={(event) => setHasOwnProductRow(event.target.value === "own")}
          >
            <option value="shared">The shared list (Products & pricing → Product rows)</option>
            <option value="own">This page&apos;s own order</option>
          </select>
        </AdminDialogField>
        {hasOwnProductRow && (
          <div className={styles["admin-product-row-own"]}>
            <ProductRowSlotsEditor
              slots={ownProductRow}
              onChange={setOwnProductRow}
              label="This page's product row"
              matchingChoices={noodlesPageOf(slug) ? noodlesRowChoices(noodlesPageOf(slug)!.kind) : []}
            />
          </div>
        )}
      </FormSection>

      <FormSection number={nextSection()} title="Show on the website">
        <AdminDialogField label="Status" isWide>
          <select className={adminInputClassName} value={status} onChange={(event) => setStatus(event.target.value as PublishStatus)}>
            <option value="published">Published: customers see the page</option>
            <option value="draft">Draft: only the preview shows it</option>
          </select>
        </AdminDialogField>
      </FormSection>

      {/* (Inside the pop-up the kind was chosen before it opened) */}
      {!isEditing && !embedded && (
        <button type="button" className={styles["admin-product-page-back-button"]} onClick={() => setStep("kind")}>
          ← Change kind
        </button>
      )}
      {onDelete && (
        <button type="button" className={styles["admin-product-page-delete-button"]} onClick={onDelete}>
          Delete product
        </button>
      )}

      {/* What is still missing, at the end of the form, right above the Save button */}
      {problems.length > 0 && (
        <div className={styles["admin-product-page-problems"]} role="alert">
          <strong>Please fill in:</strong>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
    </>,
  );
}

/*
  Product information / nutrition rows: a Label and a Value field per row, × to remove one, "+ Add" for
  more. Empty values are left out of the page; the value field shows an example for the usual labels.
*/
function InformationRowsEditor({
  rows,
  onChange,
  groupLabel,
  addLabel,
}: {
  rows: InformationRow[];
  onChange: (rows: InformationRow[]) => void;
  groupLabel: string;
  addLabel: string;
}) {
  const setRow = (index: number, changes: Partial<InformationRow>) => onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...changes } : row)));
  return (
    <div className={styles["admin-product-page-rows"]}>
      <span className={styles["admin-product-page-row-heading"]}>Label · Value</span>
      {rows.map((row, index) => (
        <div key={index} className={styles["admin-product-page-information-row"]}>
          <input className={adminInputClassName} aria-label={`${groupLabel} row ${index + 1} label`} value={row.label} onChange={(event) => setRow(index, { label: event.target.value })} placeholder="Label" />
          <input
            className={adminInputClassName}
            aria-label={`${groupLabel} row ${index + 1} value`}
            value={row.value}
            onChange={(event) => setRow(index, { value: event.target.value })}
            placeholder={INFORMATION_EXAMPLES[row.label.trim()] ?? "Value"}
          />
          <button type="button" className={styles["admin-product-page-remove-button"]} aria-label={`Remove ${groupLabel} row ${index + 1}`} onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className={styles["admin-product-page-add-button"]} onClick={() => onChange([...rows, { label: "", value: "" }])}>
        + {addLabel}
      </button>
    </div>
  );
}

/*
  The category drop-down used on Products & pricing (Add product, a product's pop-up): the standard
  categories, any the admin added, and "+ Add new category…", which shows a name box and an Add button;
  the new category is saved (it shows in the tabs and every picker) and chosen.
*/
const NEW_CATEGORY_CHOICE = "__new-category__";

export function CategoryPicker({ value, onChange }: { value: ProductCategory; onChange: (category: ProductCategory) => void }) {
  const categories = useProductCategories();
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");

  function addCategory() {
    if (!newName.trim()) return;
    onChange(addProductCategory(newName));
    setNewName("");
    setIsAdding(false);
  }

  return (
    <div className={styles["admin-product-category-picker"]}>
      <select
        className={adminInputClassName}
        value={isAdding ? NEW_CATEGORY_CHOICE : value}
        onChange={(event) => {
          if (event.target.value === NEW_CATEGORY_CHOICE) setIsAdding(true);
          else {
            setIsAdding(false);
            onChange(event.target.value);
          }
        }}
      >
        {categories.map((category) => (
          <option key={category}>{category}</option>
        ))}
        <option value={NEW_CATEGORY_CHOICE}>+ Add new category…</option>
      </select>
      {isAdding && (
        <span className={styles["admin-product-category-new-row"]}>
          <input
            className={adminInputClassName}
            value={newName}
            placeholder="New category name, e.g. Sweets"
            aria-label="New category name"
            autoFocus
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              // Enter adds the category instead of saving the whole form
              if (event.key === "Enter") {
                event.preventDefault();
                addCategory();
              }
            }}
          />
          <button type="button" className={styles["admin-product-category-add-button"]} onClick={addCategory} disabled={!newName.trim()}>
            Add
          </button>
        </span>
      )}
    </div>
  );
}

/*
  Add product, step 1 on Products & pricing: what kind of product and its category. The product is then
  filled in in the same pop-up as editing one (photo, stock, details and its website page).
*/
export function ChooseProductKindDialog({
  onChosen,
  onClose,
}: {
  onChosen: (kind: ProductKind, category: ProductCategory) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<ProductKind>("one-time");
  // Subscriptions are milk; one-time products start under Others (changeable)
  const [category, setCategory] = useState<ProductCategory>("Others");
  return (
    <AdminDialog title="Add product" onClose={onClose} onSubmit={() => onChosen(kind, category)} submitLabel="Next">
      <fieldset className={styles["admin-product-page-kind-choices"]}>
        <legend className={styles["admin-product-page-section-title"]}>What kind of product is it?</legend>
        {(
          [
            { value: "subscription", title: "Subscription", detail: "Delivered every morning on a plan (3 / 6 / 12 months), with a one-time option too. Like milk." },
            { value: "one-time", title: "One-time purchase", detail: "Bought when needed, in pack sizes (e.g. 250 ml / 500 ml / 1 litre). Like ghee, paneer or atta." },
          ] as const
        ).map((choice) => (
          <label key={choice.value} className={`${styles["admin-product-page-kind-choice"]} ${kind === choice.value ? styles["admin-product-page-kind-choice-chosen"] : ""}`}>
            <input
              type="radio"
              name="new-product-kind"
              value={choice.value}
              checked={kind === choice.value}
              onChange={() => {
                setKind(choice.value);
                if (choice.value === "subscription") setCategory("Milk");
              }}
            />
            <span>
              <strong>{choice.title}</strong>
              <span>{choice.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <AdminDialogField label="Category on Products & pricing" isWide>
        <CategoryPicker value={category} onChange={setCategory} />
      </AdminDialogField>
    </AdminDialog>
  );
}

// "Add product" (kept as the default export used by Products & pricing)
export default function AddProductPageForm({ onClose, showToast }: { onClose: () => void; showToast: (message: string) => void }) {
  return <ProductPageForm onClose={onClose} showToast={showToast} />;
}

// The "matches the page" choices of a noodles, pasta or macaroni row: another flavour, or the same flavour of the others
export function noodlesRowChoices(kind: NoodlesKind) {
  return [
    { value: OTHER_FLAVOUR_SLOT, label: `Another ${NOODLES_KIND_NAMES[kind]} flavour` },
    ...NOODLES_KINDS.filter((otherKind) => otherKind !== kind).map((otherKind) => ({
      value: sameFlavourSlot(otherKind),
      label: `Same flavour ${NOODLES_KIND_NAMES[otherKind]}`,
    })),
  ];
}

/*
  Five numbered places of a product row (Fast selling / You may also like), each a product from the website
  (or, for noodles, pasta and macaroni rows, one that matches the page: another flavour / the same flavour of
  another product), with ↑ ↓ to change the order. An empty place is skipped on the page.
*/
export function ProductRowSlotsEditor({
  slots,
  onChange,
  label,
  matchingChoices = [],
}: {
  slots: RowSlot[];
  onChange: (slots: RowSlot[]) => void;
  label: string;
  matchingChoices?: { value: RowSlot; label: string }[];
}) {
  const pages = useProductPages().filter((page) => page.status === "published");
  const places = Array.from({ length: ROW_SIZE }, (_, index) => slots[index] ?? "");
  function setPlace(index: number, value: RowSlot) {
    onChange(places.map((slot, placeIndex) => (placeIndex === index ? value : slot)));
  }
  function move(index: number, step: -1 | 1) {
    const moved = [...places];
    [moved[index], moved[index + step]] = [moved[index + step], moved[index]];
    onChange(moved);
  }
  return (
    <ol className={styles["admin-product-row-slots"]} aria-label={label}>
      {places.map((slot, index) => (
        <li key={index} className={styles["admin-product-row-slot"]}>
          <span className={styles["admin-product-row-slot-number"]} aria-hidden="true">
            {index + 1}
          </span>
          <select className={adminInputClassName} value={slot} aria-label={`${label}: place ${index + 1}`} onChange={(event) => setPlace(index, event.target.value)}>
            <option value="">Empty (skipped)</option>
            {matchingChoices.length > 0 && (
              <optgroup label="Matches the page">
                {matchingChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Products">
              {pages.map((page) => (
                <option key={page.slug} value={page.slug}>
                  {page.name}
                </option>
              ))}
            </optgroup>
          </select>
          <button type="button" className={styles["admin-product-row-move-button"]} aria-label={`Move place ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 15l6-6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            className={styles["admin-product-row-move-button"]}
            aria-label={`Move place ${index + 1} down`}
            disabled={index === ROW_SIZE - 1}
            onClick={() => move(index, 1)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </li>
      ))}
    </ol>
  );
}

// A numbered, titled group of fields across the whole form ("1  Basic details")
/*
  lockedNote: the section is frozen (a disabled fieldset greys every box and button inside) and the note says
  why. Used for the price sections when someone other than the owner edits a product.
*/
function FormSection({ number, title, children, lockedNote }: { number: number; title: string; children: ReactNode; lockedNote?: string }) {
  return (
    <section className={styles["admin-product-page-section"]}>
      <h3 className={styles["admin-product-page-section-title"]}>
        <span className={styles["admin-product-page-section-number"]} aria-hidden="true">
          {number}
        </span>
        {title}
        {lockedNote && <span className={styles["admin-product-page-section-locked-tag"]}>Locked</span>}
      </h3>
      {lockedNote && <p className={styles["admin-product-page-section-locked-note"]}>{lockedNote}</p>}
      <fieldset disabled={Boolean(lockedNote)} className={styles["admin-product-page-section-fields"]}>
        {children}
      </fieldset>
    </section>
  );
}

/*
  A product page's buttons, shown inside its card's pop-up on Products & pricing: Open (or Preview), Edit page,
  Delete page, and Restore for a page from the code that was changed or deleted.
  - added in the panel: Delete removes the page and its card(s) (asks once);
  - from the code (milk, ghee, …): Edit saves a changed copy, Delete hides it, and Restore original takes the
    code's version back.
*/
export function ProductPageCardActions({
  page,
  isDeleted = false,
  showToast,
}: {
  page: ProductPage;
  isDeleted?: boolean;
  showToast: (message: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isFromCode = isStartingProductPage(page.slug);
  const isChanged = isFromCode && !isDeleted && !startingProductPages.includes(page);

  function deleteConfirmed() {
    page.panelCardIds?.forEach((cardId) => removeProduct(cardId));
    deleteProductPage(page.slug);
    setIsDeleting(false);
    showToast(`${page.name} deleted`);
  }

  function restore() {
    restoreStartingProductPage(page.slug);
    showToast(`${page.name} is back to the original page`);
  }

  return (
    <div className={styles["admin-product-page-card-actions"]}>
      {isDeleted ? (
        <button type="button" onClick={restore}>
          Restore page
        </button>
      ) : (
        <>
          <a href={`/products/${page.slug}${page.status === "draft" ? "?preview=1" : ""}`} target="_blank" rel="noreferrer">
            {page.status === "draft" ? "Preview" : "Open"}
          </a>
          <button type="button" onClick={() => setIsEditing(true)}>
            Edit page
          </button>
          {isChanged && (
            <button type="button" onClick={restore} title="Back to the page as it is in the code">
              Restore
            </button>
          )}
          <button type="button" className={styles["admin-product-page-card-delete"]} onClick={() => setIsDeleting(true)}>
            Delete page
          </button>
        </>
      )}

      {isEditing && <ProductPageForm editingPage={page} onClose={() => setIsEditing(false)} showToast={showToast} />}

      {isDeleting && (
        <AdminDialog title={`Delete ${page.name}?`} onClose={() => setIsDeleting(false)} onSubmit={deleteConfirmed} submitLabel="Delete" isDanger>
          <p className={styles["admin-product-page-delete-text"]}>
            {isFromCode
              ? `Its page /products/${page.slug} is taken off the website. It comes from the code, so "Restore page" in its card's pop-up brings it back.`
              : `Its page /products/${page.slug} and its ${page.panelCardIds?.length ?? 0} card(s) on Products & pricing are removed. This cannot be undone.`}
          </p>
        </AdminDialog>
      )}
    </div>
  );
}

// Product pages in the code that were deleted in the panel (their cards offer "Restore page")
export function useDeletedStartingProductPages() {
  const hiddenStartingSlugs = useHiddenStartingProductSlugs();
  return startingProductPages.filter((page) => hiddenStartingSlugs.includes(page.slug));
}
