/*
  Product pages: what each kind of product page needs, and the pages the site starts with.
  There are two kinds, each drawn by its own template:
  - "subscription" (like milk): one price per unit, Subscribe & save plans (3 / 6 / 12 months) and a
    one-time tab with a bill   → components/product/subscription-product-page.tsx
  - "one-time" (like ghee, paneer, butter, atta, batter): pack sizes, quantity, Add to cart and Buy now
    → components/product/one-time-product-page.tsx
  A page is only data: /products/<slug> finds the entry and the template for its kind draws it.
  The starting pages are below; the Chiranvi Panel adds more ("Add product" on Products & pricing), saved
  by store/product-pages-store.ts (in the browser for now, in Supabase later).
*/

export type ProductKind = "subscription" | "one-time";

// Free delivery for the whole order (everything in the cart) from this amount: the cart and the product
// pages' "Add ₹… more for free delivery" both use it
export const FREE_DELIVERY_FROM = 500;
export type PublishStatus = "draft" | "published";

export type ProductPicture = {
  imageSource: string; // "/images/products/…" or a picture uploaded in the panel
  imageWidth: number;
  imageHeight: number;
  alt: string;
  isServedAsIs?: boolean; // sharp upscaled files: shown without Next's re-compression
};

// How big the picture(s) are in the picture area, as parts (%) of the area. With a width the picture is
// sized by width (never taller than heightPercent); without one it is sized by height.
export type PictureFit = { widthPercent?: number; heightPercent: number };

export type BadgeColour = "gold" | "cream" | "green" | "grey";
export type DeliveryStepIcon = "clock" | "milk-drop" | "box" | "home";
export type DeliveryStep = { icon: DeliveryStepIcon; title: string; detail: string };
export type InformationRow = { label: string; value: string };

// One card in the "Fast selling products" row ("View Product" opens /products/<productId>)
export type FastSellingCard = {
  productId: string;
  name: string;
  imageSource: string;
  imageWidth: number;
  imageHeight: number;
  ratingCount: string;
};

// The filter it shows under on the All products page (/products)
export type ShopCategory = "Milk" | "Paneer" | "Ghee" | "Butter" | "Flours" | "Batter" | "Powders" | "Noodles" | "Pasta" | "Macaroni" | "Others";
export const SHOP_CATEGORIES: ShopCategory[] = ["Milk", "Paneer", "Ghee", "Butter", "Flours", "Batter", "Powders", "Noodles", "Pasta", "Macaroni", "Others"];

type ProductPageBase = {
  slug: string; // the page address: /products/<slug>
  shopCategory?: ShopCategory; // missing: "Others"
  cardNote?: string; // after the pack size on the All products card: "1 litre · Bilona method"
  status: PublishStatus; // drafts show only in the panel's preview
  name: string;
  tagline: string;
  description: string;
  badge: { text: string; colour: BadgeColour };
  rating: { score: string; count: string }; // "4.8", "(1.5K)"
  highlights: string[]; // the ✓ chips
  pictures: ProductPicture[]; // one, or two side by side (Idli + Dosa)
  pictureFit: PictureFit;
  hasPictureShadow?: boolean;
  deliverySteps: DeliveryStep[]; // three: Order by 9 PM → … → At your door
  fastSellingCards: FastSellingCard[];
  // This page's own row under it (Edit page → "Product row on this page"), in order; missing: the shared
  // Fast selling / You may also like list (store/admin-product-rows-store.ts)
  productRowOverride?: string[];
  addedInPanel?: boolean; // false / missing: a starting page from this file
  // The product's cards on Products & pricing (store/products-store.ts) made with this page, so editing
  // or deleting the page in the panel updates or removes them too
  panelCardIds?: string[];
};

// ---------- One-time purchase ----------

export type OneTimePack = {
  packId: string; // "500-g"
  label: string; // "500 g"
  size: number; // in the price breakdown's unit (500 for 500 g with "100 g"; 5 for 5 kg with "kg")
  price: number;
  originalPrice?: number; // crossed out, only where shown
  tag?: "Best value" | "Most popular";
  itemCount?: number; // "About 20 idlis" (price breakdown "item-count")
};

/*
  The small line under the price and on each pack card:
  - per-unit: "₹69.80 per 100 g" (headline, 0 or 2 decimals) and "₹70 / 100 g" (cards, whole rupees or
    to the nearest 50 paise);
  - item-count: "About 20 idlis".
*/
export type PriceBreakdown =
  | { kind: "per-unit"; unitLabel: string; unitSize: number; headlineDecimals: 0 | 2; cardRounding: "whole" | "half"; taxNote: string }
  | { kind: "item-count"; itemLabel: string; taxNote: string };

export type OneTimeProductPage = ProductPageBase & {
  kind: "one-time";
  ratingNote: string; // green text after the rating: "Crafted with care"
  packs: OneTimePack[];
  defaultPackId: string;
  priceBreakdown: PriceBreakdown;
  cartPackWord: string; // the cart shows "500 g <word>": "glass jar", "pack", "pouch"
  quantityWord: { one: string; many: string }; // "jar" / "jars" for the − + buttons
  note: { text: string; tone: "warning" | "fresh" }; // red stock line, or green dot freshness line
  freeDelivery: { kind: "always" } | { kind: "from"; amount: number };
  review: { quote: string; name: string; area: string }; // shown with "✓ Verified buyer"
  productInformation: InformationRow[];
  nutritionFacts: InformationRow[];
  nutritionBasis: string; // "per 100 g (approx.)"
};

// ---------- Subscription ----------

export type SubscriptionPlanSetting = {
  planId: string;
  label: string; // "6 Months"
  months: number;
  days: number; // one delivery a day
  percentOff: number; // off the one-time price per unit
  tag?: "Most popular" | "Best value";
  showsSavingInDetails: boolean; // "you save ₹…" (otherwise "1L daily")
};

export type SubscriptionProductPage = ProductPageBase & {
  kind: "subscription";
  timingsStripText: string; // green strip above the navigation bar
  price: number; // one-time price per unit
  originalPrice?: number;
  unitName: string; // "litre": "₹95 / litre"
  unitShort: string; // "L": "1L daily", "Milk (2L × ₹95)"
  packShort: string; // "1 L": "Your plan: 2 × 1 L bottles every morning"
  packSize: string; // "1 litre glass bottle"
  billLabel: string; // "Milk": first line of the one-time bill
  itemWord: { one: string; many: string }; // "bottle" / "bottles"
  homesNote: { bold: string; rest: string }; // "9.3k+ homes" "get it every morning"
  plans: SubscriptionPlanSetting[];
  defaultPlanId: string;
  oneTimeDeliveryCharge: number;
  orderCutoffHour: number; // 21 = 9 PM
  deliveryByTime: string; // "7 AM"
  review: { quote: string; name: string; area: string; subscriberSince: string };
  subscriptionFastSellingCards: FastSellingCard[]; // the row under the Subscribe & save tab
  // The same tables as a one-time product (edited on Products & pricing)
  productInformation?: InformationRow[];
  nutritionFacts?: InformationRow[];
  nutritionBasis?: string;
  // Milk: also sold in 500 ml bottles, chosen on the page (switched on or off in the Chiranvi Panel)
  hasHalfLitreBottle?: boolean;
  // The 500 ml price set in the panel; missing: half the 1 litre price, rounded up
  halfLitrePrice?: number;
  // The tag on its product cards (All products, Best Sellers): missing = "Subscribe & save", "" = no tag
  cardTag?: "Subscribe & save" | "Best value" | "Most popular" | "";
};

export type ProductPage = OneTimeProductPage | SubscriptionProductPage;

// ---------- Defaults the panel starts a new page with ----------

// The one-time "Fast selling products" row (the design's five items)
export const defaultFastSellingCards: FastSellingCard[] = [
  { productId: "a2-desi-ghee", name: "A2 Desi Ghee", imageSource: "/images/products/a2-desi-gir-ghee-jar.webp", imageWidth: 788, imageHeight: 1048, ratingCount: "1,069" },
  { productId: "fresh-cow-paneer", name: "Fresh Cow Paneer", imageSource: "/images/products/a2-desi-gir-paneer-box.webp", imageWidth: 1236, imageHeight: 908, ratingCount: "982" },
  { productId: "batter-powder", name: "Batter Powder", imageSource: "/images/categories/batter-category-chiranvi-farm.webp", imageWidth: 372, imageHeight: 248, ratingCount: "764" },
  { productId: "whole-wheat-atta", name: "Flours", imageSource: "/images/categories/flours-category-chiranvi-farm.webp", imageWidth: 412, imageHeight: 276, ratingCount: "1,106" },
  { productId: "desi-white-butter", name: "Desi White Butter", imageSource: "/images/categories/butter-category.webp", imageWidth: 412, imageHeight: 272, ratingCount: "646" },
];

// The subscription tab's row (the landing page's Best Sellers products)
export const defaultSubscriptionFastSellingCards: FastSellingCard[] = [
  { productId: "a2-desi-milk", name: "A2 Desi Milk", imageSource: "/images/products/a2-desi-gir-milk-bottle.webp", imageWidth: 569, imageHeight: 1112, ratingCount: "7,105" },
  { productId: "a2-desi-ghee", name: "A2 Desi Ghee", imageSource: "/images/products/a2-desi-gir-ghee-jar.webp", imageWidth: 788, imageHeight: 1048, ratingCount: "7,105" },
  { productId: "fresh-cow-paneer", name: "Fresh Cow Paneer", imageSource: "/images/products/a2-desi-gir-paneer-box.webp", imageWidth: 1236, imageHeight: 908, ratingCount: "7,105" },
  { productId: "moringa-powder", name: "Moringa Powder", imageSource: "/images/products/moringa-leaves-powder-pouch.webp", imageWidth: 336, imageHeight: 516, ratingCount: "7,105" },
  { productId: "menthya-mudde-powder", name: "Menthya Mudde Powder", imageSource: "/images/products/menthya-mudde-powder-pouch.webp", imageWidth: 677, imageHeight: 670, ratingCount: "new" },
];

// Subscribe & save plans a new subscription product starts with (the milk page's)
export const defaultSubscriptionPlans: SubscriptionPlanSetting[] = [
  { planId: "3-months", label: "3 Months", months: 3, days: 90, percentOff: 5, showsSavingInDetails: false },
  { planId: "6-months", label: "6 Months", months: 6, days: 180, percentOff: 8, tag: "Most popular", showsSavingInDetails: true },
  { planId: "12-months", label: "12 Months", months: 12, days: 365, percentOff: 13, tag: "Best value", showsSavingInDetails: true },
];

export const orderByNineStep: DeliveryStep = { icon: "clock", title: "Order by 9 PM", detail: "Tonight" };
export const atYourDoorStep: DeliveryStep = { icon: "home", title: "At your door", detail: "By 7 AM" };

// ---------- The pages the site starts with (copied from the first hand-made pages) ----------

/*
  The milks point to each other: each milk page's Fast selling rows (both tabs) start with the next milk,
  A2 (Gir) → Jersey → Skimmed → A2, then the row's other products (five cards in all). The cards take their
  name, picture and price from the product's own page.
*/
function startsWithNextMilk(cards: FastSellingCard[], nextMilk: { productId: string; name: string }): FastSellingCard[] {
  const nextMilkCard: FastSellingCard = {
    productId: nextMilk.productId,
    name: nextMilk.name,
    imageSource: "/images/products/a2-desi-gir-milk-bottle.webp",
    imageWidth: 569,
    imageHeight: 1112,
    ratingCount: "",
  };
  const milkSlugs = ["a2-desi-milk", "jersey-milk", "skimmed-milk"];
  return [nextMilkCard, ...cards.filter((card) => !milkSlugs.includes(card.productId))].slice(0, 5);
}

const milkPage: SubscriptionProductPage = {
  kind: "subscription",
  slug: "a2-desi-milk",
  shopCategory: "Milk",
  cardNote: "glass bottle",
  status: "published",
  name: "A2 Milk (Gir Cow)",
  tagline: "Fresh, Raw & Unprocessed",
  description:
    "Pure A2 milk from our own Gir cows, milked at dawn and delivered chilled the same morning. No adulteration, no preservatives, no hormones.",
  badge: { text: "Best seller", colour: "grey" },
  rating: { score: "4.8", count: "(12.4k)" },
  homesNote: { bold: "9.3k+ homes", rest: "get it every morning" },
  highlights: ["No Urea", "100% Raw Milk", "No Hormones", "No Preservatives"],
  pictures: [
    { imageSource: "/images/products/a2-desi-gir-milk-bottle.webp", imageWidth: 569, imageHeight: 1112, alt: "Chiranvi Farms Desi Cow Milk in a glass bottle" },
  ],
  pictureFit: { heightPercent: 94 },
  timingsStripText: "Order by 9 PM for delivery tomorrow by 7 AM · Free delivery on all subscriptions",
  price: 105,
  unitName: "litre",
  unitShort: "L",
  packShort: "1 L",
  packSize: "1 litre glass bottle",
  billLabel: "Milk",
  itemWord: { one: "bottle", many: "bottles" },
  plans: defaultSubscriptionPlans,
  defaultPlanId: "6-months",
  oneTimeDeliveryCharge: 30,
  orderCutoffHour: 21,
  deliveryByTime: "7 AM",
  review: {
    quote: "Tastes like the milk we had in our village. Thick, fresh, and the morning delivery is always on time.",
    name: "Lakshmi R.",
    area: "Basavanagudi",
    subscriberSince: "Subscriber for 8 months",
  },
  deliverySteps: [orderByNineStep, { icon: "milk-drop", title: "Milked at 5 AM", detail: "Chilled within minutes" }, atYourDoorStep],
  fastSellingCards: startsWithNextMilk(defaultFastSellingCards, { productId: "jersey-milk", name: "Jersey Milk" }),
  subscriptionFastSellingCards: startsWithNextMilk(defaultSubscriptionFastSellingCards, { productId: "jersey-milk", name: "Jersey Milk" }),
  hasHalfLitreBottle: true,
};

/*
  Jersey and Skimmed milk: the same page as A2 milk (subscription, 1 L or 500 ml) with their own name, text
  and price. They start with the A2 milk's picture, review-free; the picture and texts are changed in the
  Chiranvi Panel (Product pages → Edit).
*/
const jerseyMilkPage: SubscriptionProductPage = {
  ...milkPage,
  slug: "jersey-milk",
  name: "Jersey Milk",
  tagline: "Creamy, Fresh & Everyday",
  description: "Fresh milk from our Jersey cows, milked at dawn and delivered chilled the same morning. Creamy and wholesome for tea, coffee and everyday cooking.",
  badge: { text: "Everyday milk", colour: "cream" },
  rating: { score: "4.6", count: "(new)" },
  homesNote: { bold: "", rest: "" },
  highlights: ["Farm fresh", "No Hormones", "No Preservatives", "Delivered chilled"],
  pictures: [{ imageSource: "/images/products/jersey-cow-milk-bottle.webp", imageWidth: 568, imageHeight: 1112, alt: "Chiranvi Farms Jersey milk in a glass bottle" }],
  price: 60,
  review: { quote: "", name: "", area: "", subscriberSince: "" },
  fastSellingCards: startsWithNextMilk(defaultFastSellingCards, { productId: "skimmed-milk", name: "Skimmed Milk" }),
  subscriptionFastSellingCards: startsWithNextMilk(defaultSubscriptionFastSellingCards, { productId: "skimmed-milk", name: "Skimmed Milk" }),
};

const skimmedMilkPage: SubscriptionProductPage = {
  ...milkPage,
  slug: "skimmed-milk",
  name: "Skimmed Milk",
  tagline: "Light, Low-Fat & Fresh",
  description: "Our fresh farm milk with the cream taken off: all the goodness of milk with less fat. Milked at dawn and delivered chilled the same morning.",
  badge: { text: "Low fat", colour: "green" },
  rating: { score: "4.6", count: "(new)" },
  homesNote: { bold: "", rest: "" },
  highlights: ["Low fat", "Farm fresh", "No Preservatives", "Delivered chilled"],
  pictures: [{ imageSource: "/images/products/skimmed-milk-bottle.webp", imageWidth: 564, imageHeight: 1100, alt: "Chiranvi Farms skimmed milk in a glass bottle" }],
  price: 95,
  review: { quote: "", name: "", area: "", subscriberSince: "" },
  fastSellingCards: startsWithNextMilk(defaultFastSellingCards, { productId: "a2-desi-milk", name: "A2 Milk (Gir Cow)" }),
  subscriptionFastSellingCards: startsWithNextMilk(defaultSubscriptionFastSellingCards, { productId: "a2-desi-milk", name: "A2 Milk (Gir Cow)" }),
};

const gheePage: OneTimeProductPage = {
  kind: "one-time",
  slug: "a2-desi-ghee",
  shopCategory: "Ghee",
  cardNote: "Bilona method",
  status: "published",
  name: "A2 Desi Cow Ghee",
  tagline: "Traditional Bilona Ghee, Golden & Pure",
  description:
    "Made from desi cow curd using the traditional bilona method, our ghee is slowly heated to develop its rich aroma, golden colour and authentic taste. A wholesome touch for everyday cooking and traditional recipes.",
  badge: { text: "Farm favourite", colour: "gold" },
  rating: { score: "4.8", count: "(1.5K)" },
  ratingNote: "Crafted with care",
  highlights: ["Lab-tested", "Bilona method", "No preservatives", "Glass jar"],
  pictures: [
    { imageSource: "/images/products/a2-desi-gir-ghee-jar.webp", imageWidth: 788, imageHeight: 1048, alt: "Chiranvi Farms Desi Ghee in a glass jar" },
  ],
  pictureFit: { heightPercent: 80 },
  // Starting prices (set the real ones in the Chiranvi Panel → Products & pricing → Edit page): 1 litre,
  // and 500 ml / 250 ml at a half / a quarter of it (rounded up), like the milk; no crossed-out price
  packs: [
    { packId: "250-ml", label: "250 ml", size: 250, price: 350 },
    { packId: "500-ml", label: "500 ml", size: 500, price: 700 },
    { packId: "1-litre", label: "1 litre", size: 1000, price: 1399, tag: "Best value" },
  ],
  defaultPackId: "1-litre",
  priceBreakdown: { kind: "per-unit", unitLabel: "100 ml", unitSize: 100, headlineDecimals: 0, cardRounding: "whole", taxNote: "incl. all taxes" },
  cartPackWord: "glass jar",
  quantityWord: { one: "jar", many: "jars" },
  note: { text: "Only 18 jars left in Batch #4542", tone: "warning" },
  freeDelivery: { kind: "always" },
  review: { quote: "Smells exactly like the ghee my mother made. Lovely grainy texture, and it lasts us a whole month.", name: "Priya R.", area: "Jayanagar" },
  deliverySteps: [orderByNineStep, { icon: "box", title: "Packed fresh", detail: "From this week’s batch" }, atYourDoorStep],
  productInformation: [
    { label: "Ingredients", value: "Milk fat from A2 desi cow milk" },
    { label: "Net quantity", value: "250 ml / 500 ml / 1 litre" },
    { label: "Shelf life", value: "Best within 9 months" },
    { label: "Storage", value: "Keep at room temperature" },
    { label: "Country of origin", value: "India" },
    { label: "Manufactured by", value: "Chiranvi Farm, [add address]" },
    { label: "FSSAI Lic. No.", value: "[add number]" },
  ],
  nutritionFacts: [
    { label: "Energy", value: "897 kcal" },
    { label: "Protein", value: "0 g" },
    { label: "Total fat", value: "99.7 g" },
    { label: "Saturated fat", value: "61 g" },
    { label: "Carbohydrate", value: "0 g" },
  ],
  nutritionBasis: "per 100 g (approx.)",
  fastSellingCards: defaultFastSellingCards,
};

/*
  Jersey ghee: the A2 ghee's page with its own name, text and (starting) prices; the picture, texts and
  prices are changed in the Chiranvi Panel (Product pages → Edit).
*/
const jerseyGheePage: OneTimeProductPage = {
  ...gheePage,
  slug: "jersey-ghee",
  cardNote: "slow-cooked",
  name: "Jersey Cow Ghee",
  tagline: "Golden, Aromatic & Pure",
  description:
    "Made from the cream of our Jersey cows' milk and slowly heated to bring out its rich aroma and golden colour. A wholesome everyday ghee for cooking and traditional recipes.",
  badge: { text: "Everyday ghee", colour: "cream" },
  rating: { score: "4.6", count: "(new)" },
  ratingNote: "Slow-cooked",
  highlights: ["Lab-tested", "Slow-cooked", "No preservatives", "Glass jar"],
  pictures: [{ imageSource: "/images/products/jersey-cow-ghee-jar.webp", imageWidth: 792, imageHeight: 1056, alt: "Chiranvi Farms Jersey cow ghee in a glass jar" }],
  packs: [
    { packId: "250-ml", label: "250 ml", size: 250, price: 275 },
    { packId: "500-ml", label: "500 ml", size: 500, price: 550 },
    { packId: "1-litre", label: "1 litre", size: 1000, price: 1099, tag: "Best value" },
  ],
  note: { text: "Made in small batches · keep at room temperature", tone: "fresh" },
  review: { quote: "", name: "", area: "" },
  productInformation: gheePage.productInformation.map((row) =>
    row.label === "Ingredients" ? { ...row, value: "Milk fat from Jersey cow milk" } : row,
  ),
};

const paneerPage: OneTimeProductPage = {
  kind: "one-time",
  slug: "fresh-cow-paneer",
  shopCategory: "Paneer",
  cardNote: "made today",
  status: "published",
  name: "A2 Desi Gir Paneer",
  tagline: "Soft, Creamy & Made Fresh",
  description:
    "Made from fresh A2 cow milk, our soft and creamy paneer brings natural goodness and authentic taste to your everyday meals. No added starch, no fillers, just wholesome dairy goodness.",
  badge: { text: "Fresh daily", colour: "green" },
  rating: { score: "4.7", count: "1.2K" },
  ratingNote: "Farm Fresh",
  highlights: ["Freshly Made", "Rich & Creamy", "No starch", "A2 Cow Milk"],
  pictures: [
    {
      imageSource: "/images/products/a2-desi-gir-paneer-box.webp",
      imageWidth: 1236,
      imageHeight: 908,
      alt: "Chiranvi Farm fresh and natural paneer box",
      isServedAsIs: true,
    },
  ],
  pictureFit: { widthPercent: 72, heightPercent: 80 },
  // One pack only: more paneer is bought with "− quantity +"
  packs: [{ packId: "250-g", label: "250 g", size: 250, price: 165 }],
  defaultPackId: "250-g",
  priceBreakdown: { kind: "per-unit", unitLabel: "100 g", unitSize: 100, headlineDecimals: 2, cardRounding: "half", taxNote: "Inclusive of all taxes" },
  cartPackWord: "pack",
  quantityWord: { one: "pack", many: "packs" },
  note: { text: "Freshly prepared · Delivered chilled", tone: "fresh" },
  freeDelivery: { kind: "from", amount: FREE_DELIVERY_FROM },
  review: { quote: "So soft it melts in the gravy. My kids won’t eat packet paneer any more.", name: "Arjun K.", area: "Whitefield" },
  deliverySteps: [orderByNineStep, { icon: "box", title: "Made at 4 AM", detail: "From fresh milk" }, atYourDoorStep],
  productInformation: [
    { label: "Ingredients", value: "Cow milk, citric acid" },
    { label: "Net quantity", value: "250 g" },
    { label: "Shelf life", value: "Best within 3 days" },
    { label: "Storage", value: "Refrigerate at 0 to 4 °C" },
    { label: "Country of origin", value: "India" },
    { label: "Manufactured by", value: "Chiranvi Farm, [add address]" },
    { label: "FSSAI Lic. No.", value: "[add number]" },
  ],
  nutritionFacts: [
    { label: "Energy", value: "265 kcal" },
    { label: "Protein", value: "18 g" },
    { label: "Total fat", value: "20 g" },
    { label: "Carbohydrate", value: "3.4 g" },
    { label: "Calcium", value: "208 mg" },
  ],
  nutritionBasis: "per 100 g (approx.)",
  fastSellingCards: defaultFastSellingCards,
};

const butterPage: OneTimeProductPage = {
  kind: "one-time",
  slug: "desi-white-butter",
  shopCategory: "Butter",
  cardNote: "hand-churned",
  status: "published",
  name: "A2 Desi Butter",
  tagline: "Pure from Desi Cow Milk",
  description:
    "Enjoy the soft, creamy taste of traditional makkhan, carefully churned from desi cow curd. With its rich texture and authentic flavour, it brings a touch of farm-fresh goodness to your breakfast, rotis and favourite homemade recipes.",
  badge: { text: "Traditional goodness", colour: "cream" },
  rating: { score: "4.8", count: "(1.1K)" },
  ratingNote: "Freshly Churned",
  highlights: ["Hand-churned", "Unsalted", "No preservatives", "Lab-tested"],
  pictures: [
    { imageSource: "/images/categories/butter-category.webp", imageWidth: 412, imageHeight: 272, alt: "Chiranvi Farm desi white butter on a wooden board" },
  ],
  pictureFit: { widthPercent: 72, heightPercent: 80 },
  // 1 kg ₹1,150; 500 g and 250 g are half and a quarter of it (rounded up), no crossed-out price
  packs: [
    { packId: "250-g", label: "250 g", size: 250, price: 288 },
    { packId: "500-g", label: "500 g", size: 500, price: 575 },
    { packId: "1-kg", label: "1 kg", size: 1000, price: 1150, tag: "Best value" },
  ],
  defaultPackId: "1-kg",
  priceBreakdown: { kind: "per-unit", unitLabel: "100 g", unitSize: 100, headlineDecimals: 2, cardRounding: "whole", taxNote: "Inclusive of all taxes" },
  cartPackWord: "pack",
  quantityWord: { one: "pack", many: "packs" },
  note: { text: "Churned this week · keep refrigerated", tone: "fresh" },
  freeDelivery: { kind: "from", amount: FREE_DELIVERY_FROM },
  review: { quote: "Tastes just like the makkhan at my nani’s house. Perfect on hot parathas.", name: "Rohit M.", area: "Koramangala" },
  deliverySteps: [orderByNineStep, { icon: "box", title: "Churned fresh", detail: "This week’s batch" }, atYourDoorStep],
  productInformation: [
    { label: "Ingredients", value: "Cream from desi cow curd" },
    { label: "Net quantity", value: "250 g / 500 g / 1 kg" },
    { label: "Shelf life", value: "Best within 7 days" },
    { label: "Storage", value: "Refrigerate at 0 to 4 °C" },
    { label: "Country of origin", value: "India" },
    { label: "Manufactured by", value: "Chiranvi Farm, [add address]" },
    { label: "FSSAI Lic. No.", value: "[add number]" },
  ],
  nutritionFacts: [
    { label: "Energy", value: "720 kcal" },
    { label: "Protein", value: "0.9 g" },
    { label: "Total fat", value: "80 g" },
    { label: "Saturated fat", value: "51 g" },
    { label: "Carbohydrate", value: "0.6 g" },
  ],
  nutritionBasis: "per 100 g (approx.)",
  fastSellingCards: defaultFastSellingCards,
};

/*
  Jersey butter: the A2 butter's page with its own name, text and packs (250 g / 500 g / 1 kg, no crossed-out
  price). Its prices are placeholders from the old 500 g price (₹399) until they are set in the Chiranvi
  Panel (Products & pricing → Jersey Cow Butter → Edit page), like its picture and texts.
*/
const jerseyButterPage: OneTimeProductPage = {
  ...butterPage,
  slug: "jersey-butter",
  cardNote: "fresh-churned",
  name: "Jersey Cow Butter",
  tagline: "Soft, Creamy & Fresh",
  description:
    "Soft white butter churned from the cream of our Jersey cows' milk. Rich and creamy for breakfast, rotis and everyday homemade recipes.",
  badge: { text: "Everyday butter", colour: "cream" },
  rating: { score: "4.6", count: "(new)" },
  pictures: [{ ...butterPage.pictures[0], alt: "Chiranvi Farm Jersey cow white butter on a wooden board" }],
  packs: [
    { packId: "250-g", label: "250 g", size: 250, price: 200 },
    { packId: "500-g", label: "500 g", size: 500, price: 399 },
    { packId: "1-kg", label: "1 kg", size: 1000, price: 798, tag: "Best value" },
  ],
  review: { quote: "", name: "", area: "" },
  productInformation: butterPage.productInformation.map((row) =>
    row.label === "Ingredients" ? { ...row, value: "Cream from Jersey cow milk" } : row,
  ),
};

const attaPage: OneTimeProductPage = {
  kind: "one-time",
  slug: "whole-wheat-atta",
  shopCategory: "Flours",
  cardNote: "stone-ground",
  status: "published",
  name: "Whole Wheat Atta",
  tagline: "Traditional Chakki-Ground Goodness",
  description:
    "Made from carefully selected whole wheat grains and traditionally stone-ground to retain their natural goodness. Enjoy soft rotis, fluffy chapatis and delicious homemade parathas with wholesome flavour in every bite.",
  badge: { text: "Fresh from the chakki", colour: "cream" },
  rating: { score: "4.7", count: "(2.4K)" },
  ratingNote: "Freshly Milled",
  highlights: ["Stone-ground", "100% whole wheat", "No maida", "Lab-tested"],
  pictures: [
    {
      imageSource: "/images/products/whole-wheat-atta-pack.webp",
      imageWidth: 1984,
      imageHeight: 1806,
      alt: "Chiranvi Farm whole wheat atta pouch with a bowl of flour and wheat",
    },
  ],
  pictureFit: { widthPercent: 78, heightPercent: 88 },
  packs: [
    { packId: "1-kg", label: "1 kg", size: 1, price: 79 },
    { packId: "2-kg", label: "2 kg", size: 2, price: 149 },
    { packId: "5-kg", label: "5 kg", size: 5, price: 329, originalPrice: 399, tag: "Best value" },
  ],
  defaultPackId: "5-kg",
  priceBreakdown: { kind: "per-unit", unitLabel: "kg", unitSize: 1, headlineDecimals: 2, cardRounding: "whole", taxNote: "Inclusive of all taxes" },
  cartPackWord: "pouch",
  quantityWord: { one: "pack", many: "packs" },
  note: { text: "Milled this week · resealable zip pouch", tone: "fresh" },
  freeDelivery: { kind: "from", amount: FREE_DELIVERY_FROM },
  review: { quote: "Rotis stay soft even in the lunch box. You can smell the fresh wheat when you open the pack.", name: "Kavya P.", area: "Malleshwaram" },
  deliverySteps: [orderByNineStep, { icon: "box", title: "Milled fresh", detail: "This week’s batch" }, { icon: "home", title: "At your door", detail: "By tomorrow" }],
  productInformation: [
    { label: "Ingredients", value: "100% whole wheat" },
    { label: "Net quantity", value: "1 kg / 2 kg / 5 kg" },
    { label: "Shelf life", value: "Best within 3 months" },
    { label: "Storage", value: "Cool, dry place" },
    { label: "Country of origin", value: "India" },
    { label: "Manufactured by", value: "Chiranvi Farm, [add address]" },
    { label: "FSSAI Lic. No.", value: "[add number]" },
  ],
  nutritionFacts: [
    { label: "Energy", value: "340 kcal" },
    { label: "Protein", value: "12 g" },
    { label: "Total fat", value: "1.7 g" },
    { label: "Carbohydrate", value: "72 g" },
    { label: "Dietary fibre", value: "11 g" },
  ],
  nutritionBasis: "per 100 g (approx.)",
  fastSellingCards: defaultFastSellingCards,
};

/*
  The wheat attas sold now: Kapti and Jave wheat (they replace Whole Wheat Atta, whose page above is only
  their template and is no longer on the website), and Multigrain atta. Starting prices; the real prices,
  sizes and pictures are set in the Chiranvi Panel (Products & pricing → Edit page). Kapti and Jave use the
  atta picture until their own is uploaded.
*/
const kaptiWheatAttaPage: OneTimeProductPage = {
  ...attaPage,
  slug: "kapti-wheat-atta",
  name: "Kapti Wheat Atta",
  tagline: "Stone-Ground Kapti Wheat, Soft Rotis",
  description:
    "Made from Kapti wheat grains, cleaned and stone-ground in small batches to keep their natural goodness. Makes soft rotis, chapatis and parathas with a rich, wholesome taste.",
  badge: { text: "Traditional wheat", colour: "cream" },
  highlights: ["Stone-ground", "100% Kapti wheat", "No maida", "No preservatives"],
  pictures: [{ ...attaPage.pictures[0], alt: "Chiranvi Farm Kapti wheat atta pouch with a bowl of flour and wheat" }],
  packs: [
    { packId: "1-kg", label: "1 kg", size: 1, price: 79 },
    { packId: "2-kg", label: "2 kg", size: 2, price: 149 },
    { packId: "5-kg", label: "5 kg", size: 5, price: 329, tag: "Best value" },
  ],
  review: { quote: "", name: "", area: "" },
  productInformation: attaPage.productInformation.map((row) => (row.label === "Ingredients" ? { ...row, value: "100% Kapti wheat" } : row)),
};

const javeWheatAttaPage: OneTimeProductPage = {
  ...kaptiWheatAttaPage,
  slug: "jave-wheat-atta",
  name: "Jave Wheat Atta",
  tagline: "Stone-Ground Jave Wheat, Rich & Wholesome",
  description:
    "Made from Jave wheat grains, cleaned and stone-ground in small batches. A traditional wheat for soft rotis, chapatis and everyday cooking with a rich, nutty taste.",
  highlights: ["Stone-ground", "100% Jave wheat", "No maida", "No preservatives"],
  pictures: [{ ...attaPage.pictures[0], alt: "Chiranvi Farm Jave wheat atta pouch with a bowl of flour and wheat" }],
  productInformation: attaPage.productInformation.map((row) => (row.label === "Ingredients" ? { ...row, value: "100% Jave wheat" } : row)),
};

const multigrainAttaPage: OneTimeProductPage = {
  ...attaPage,
  slug: "multigrain-atta-flour",
  cardNote: "many grains",
  name: "Multigrain Atta Flour",
  tagline: "One Flour, Many Grains",
  description:
    "A wholesome blend of wheat and other grains, stone-ground in small batches. Makes soft, tasty rotis and chapatis for the whole family.",
  badge: { text: "Wholesome blend", colour: "green" },
  rating: { score: "4.6", count: "(new)" },
  highlights: ["Stone-ground", "Many grains", "No maida", "No preservatives"],
  // The pouch from the ad (cropped, edges faded into the page)
  pictures: [
    { imageSource: "/images/products/multigrain-atta-flour-pouch.webp", imageWidth: 642, imageHeight: 734, alt: "Chiranvi Farm multigrain atta flour pouch with a bowl of flour and rotis" },
  ],
  pictureFit: { widthPercent: 66, heightPercent: 86 },
  // One pack only (more with "− quantity +")
  packs: [{ packId: "2-kg", label: "2 kg", size: 2, price: 229 }],
  defaultPackId: "2-kg",
  review: { quote: "", name: "", area: "" },
  productInformation: attaPage.productInformation.map((row) =>
    row.label === "Ingredients"
      ? { ...row, value: "Wheat and other grains [add the grains used]" }
      : row.label === "Net quantity"
        ? { ...row, value: "2 kg" }
        : row,
  ),
  nutritionFacts: [],
  nutritionBasis: "",
};

/*
  Ragi flour: the atta page's one-time template (the same as ghee's) with its own text. Its pack picture is
  still to come, so it uses the site's flours picture until one is uploaded in the Chiranvi Panel (Product
  pages → Edit).
*/
const ragiFlourPage: OneTimeProductPage = {
  ...attaPage,
  slug: "ragi-flour",
  name: "Ragi Flour",
  tagline: "Stone-Ground Finger Millet, Rich in Calcium",
  description:
    "Made from cleaned, sun-dried ragi (finger millet) and stone-ground in small batches. Perfect for ragi mudde, dosa, rotis, porridge for little ones and healthy baking.",
  badge: { text: "Millet goodness", colour: "cream" },
  rating: { score: "4.6", count: "(402)" },
  ratingNote: "Freshly milled",
  highlights: ["Stone-ground", "100% ragi", "Gluten-free", "No preservatives"],
  pictures: [
    { imageSource: "/images/categories/flours-category-chiranvi-farm.webp", imageWidth: 412, imageHeight: 276, alt: "Chiranvi Farm Ragi Flour pouch with ragi and a bowl of flour" },
  ],
  // 1 / 2 / 5 kg (starting prices from ₹119 a kg; set the real ones in the Chiranvi Panel), no crossed-out price
  packs: [
    { packId: "1-kg", label: "1 kg", size: 1, price: 119 },
    { packId: "2-kg", label: "2 kg", size: 2, price: 229 },
    { packId: "5-kg", label: "5 kg", size: 5, price: 549, tag: "Best value" },
  ],
  defaultPackId: "1-kg",
  review: { quote: "", name: "", area: "" },
  productInformation: attaPage.productInformation.map((row) =>
    row.label === "Ingredients"
      ? { ...row, value: "100% ragi (finger millet)" }
      : row.label === "Net quantity"
        ? { ...row, value: "1 kg / 2 kg / 5 kg" }
        : row,
  ),
  nutritionFacts: [
    { label: "Energy", value: "320 kcal" },
    { label: "Protein", value: "7 g" },
    { label: "Total fat", value: "1.9 g" },
    { label: "Carbohydrate", value: "66 g" },
    { label: "Dietary fibre", value: "11 g" },
    { label: "Calcium", value: "344 mg" },
  ],
};

const batterPage: OneTimeProductPage = {
  kind: "one-time",
  slug: "batter-powder",
  shopCategory: "Batter",
  cardNote: "ground today",
  status: "published",
  name: "Idli & Dosa Batter",
  tagline: "Traditional Taste, Naturally Fermented",
  description:
    "Prepared with rice and urad dal, soaked, ground and naturally fermented for soft idlis and crispy golden dosas. Enjoy the comfort of traditional homemade breakfasts.",
  badge: { text: "Freshly prepared", colour: "green" },
  rating: { score: "4.8", count: "(1.3K)" },
  ratingNote: "1,500+ breakfasts a week",
  highlights: ["Freshly Ground", "No soda", "Naturally Fermented", "No Added Preservatives"],
  pictures: [
    { imageSource: "/images/products/idli-batter-powder-pack.webp", imageWidth: 1808, imageHeight: 2744, alt: "Chiranvi Farm Idli batter powder pouch", isServedAsIs: true },
    { imageSource: "/images/products/dosa-batter-powder-pack.webp", imageWidth: 1824, imageHeight: 2772, alt: "Chiranvi Farm Dosa batter powder pouch", isServedAsIs: true },
  ],
  pictureFit: { widthPercent: 34, heightPercent: 84 },
  hasPictureShadow: true,
  packs: [
    // One pack only (more with "− quantity +"); sizes and prices can be changed in the Chiranvi Panel
    { packId: "1-kg", label: "1 kg", size: 1000, price: 99, originalPrice: 120, itemCount: 20 },
  ],
  defaultPackId: "1-kg",
  priceBreakdown: { kind: "item-count", itemLabel: "idlis", taxNote: "incl. all taxes" },
  cartPackWord: "pack",
  quantityWord: { one: "pack", many: "packs" },
  note: { text: "Ground this morning · best within 3 days, refrigerated", tone: "fresh" },
  freeDelivery: { kind: "from", amount: FREE_DELIVERY_FROM },
  review: { quote: "Soft idlis and crisp dosas, just like home. Saves me so much time on weekday mornings.", name: "Lakshmi R.", area: "Basavanagudi" },
  deliverySteps: [orderByNineStep, { icon: "box", title: "Ground at 4 AM", detail: "Fresh batch" }, atYourDoorStep],
  productInformation: [
    { label: "Ingredients", value: "Rice, urad dal, methi seeds, salt" },
    { label: "Net quantity", value: "1 kg" },
    { label: "Shelf life", value: "Best within 3 days" },
    { label: "Storage", value: "Refrigerate at 0 to 4 °C" },
    { label: "Country of origin", value: "India" },
    { label: "Manufactured by", value: "Chiranvi Farm, [add address]" },
    { label: "FSSAI Lic. No.", value: "[add number]" },
  ],
  nutritionFacts: [
    { label: "Energy", value: "120 kcal" },
    { label: "Protein", value: "4 g" },
    { label: "Total fat", value: "0.5 g" },
    { label: "Carbohydrate", value: "26 g" },
    { label: "Dietary fibre", value: "1.5 g" },
  ],
  nutritionBasis: "per 100 g (approx.)",
  fastSellingCards: defaultFastSellingCards,
};

/*
  Coriander powder: no longer sold, but its page is the template the other powders are built on (Moringa,
  then Menthya Mudde and Millet Ganji). Picture: the admin's upload, cut out (see-through, shadow below).
*/
const corianderPage: OneTimeProductPage = {
  kind: "one-time",
  slug: "coriander-powder",
  shopCategory: "Powders",
  cardNote: "stone-ground",
  status: "published",
  name: "Coriander Powder",
  tagline: "Freshly Ground, Fragrant Dhaniya",
  description:
    "Made from sun-dried coriander seeds, gently roasted and stone-ground in small batches to keep their warm, citrusy aroma. A spoonful lifts curries, sambar, dals and everyday masalas.",
  badge: { text: "Kitchen essential", colour: "cream" },
  rating: { score: "4.6", count: "(new)" },
  ratingNote: "Small-batch ground",
  highlights: ["Sun-dried seeds", "Stone-ground", "No added colour", "No preservatives"],
  pictures: [
    { imageSource: "/images/products/coriander-powder-bowl.webp", imageWidth: 948, imageHeight: 804, alt: "Chiranvi Farm coriander powder in a wooden bowl" },
  ],
  // The panel's automatic size for this shape (fitForPicture), like the other products
  pictureFit: { widthPercent: 61, heightPercent: 78 },
  packs: [
    { packId: "100-g", label: "100 g", size: 100, price: 59 },
    { packId: "250-g", label: "250 g", size: 250, price: 139 },
    { packId: "500-g", label: "500 g", size: 500, price: 250, originalPrice: 299, tag: "Best value" },
  ],
  defaultPackId: "500-g",
  priceBreakdown: { kind: "per-unit", unitLabel: "100 g", unitSize: 100, headlineDecimals: 2, cardRounding: "half", taxNote: "Inclusive of all taxes" },
  cartPackWord: "pouch",
  quantityWord: { one: "pack", many: "packs" },
  note: { text: "Ground in small batches · resealable zip pouch", tone: "fresh" },
  freeDelivery: { kind: "from", amount: FREE_DELIVERY_FROM },
  review: { quote: "", name: "", area: "" },
  deliverySteps: [orderByNineStep, { icon: "box", title: "Packed fresh", detail: "Small batches" }, { icon: "home", title: "At your door", detail: "By tomorrow" }],
  productInformation: [
    { label: "Ingredients", value: "100% coriander seeds" },
    { label: "Net quantity", value: "100 g / 250 g / 500 g" },
    { label: "Shelf life", value: "Best within 6 months" },
    { label: "Storage", value: "Cool, dry place; close the pouch after use" },
    { label: "Country of origin", value: "India" },
    { label: "Manufactured by", value: "Chiranvi Farm, [add address]" },
    { label: "FSSAI Lic. No.", value: "[add number]" },
  ],
  nutritionFacts: [
    { label: "Energy", value: "298 kcal" },
    { label: "Protein", value: "12 g" },
    { label: "Total fat", value: "18 g" },
    { label: "Carbohydrate", value: "55 g" },
    { label: "Dietary fibre", value: "42 g" },
  ],
  nutritionBasis: "per 100 g (approx.)",
  fastSellingCards: defaultFastSellingCards,
};

/*
  Moringa powder (a Best Seller): the ghee page's one-time template with its own text and pouch picture. Its
  address matches its card on Products & pricing (store/products-store.ts), so Best Sellers opens it and
  Sold out there shows here. Starting prices (500 g = the card's ₹249, was ₹389); the prices, packs, picture
  and text are changed in the Chiranvi Panel (Product pages → Edit).
*/
const moringaPage: OneTimeProductPage = {
  ...corianderPage,
  slug: "moringa-powder",
  cardNote: "shade-dried leaves",
  name: "Moringa Powder",
  tagline: "Shade-Dried Drumstick Leaves, Finely Ground",
  description:
    "Made from fresh drumstick (moringa) leaves, shade-dried to keep their green colour and goodness, then finely ground in small batches. Stir a spoonful into smoothies, dals, chapati dough or warm water every day.",
  badge: { text: "Green superfood", colour: "green" },
  rating: { score: "4.5", count: "(7,105)" },
  ratingNote: "Small-batch ground",
  highlights: ["Shade-dried leaves", "Finely ground", "No added colour", "No preservatives"],
  // The kraft pouch from the ad (cropped, edges faded into the page)
  pictures: [
    { imageSource: "/images/products/moringa-powder-kraft-pouch.webp", imageWidth: 758, imageHeight: 747, alt: "Chiranvi Farm moringa powder in a kraft pouch with a bowl of powder" },
  ],
  pictureFit: { widthPercent: 70, heightPercent: 84 },
  packs: [
    { packId: "100-g", label: "100 g", size: 100, price: 69 },
    { packId: "250-g", label: "250 g", size: 250, price: 149 },
    { packId: "500-g", label: "500 g", size: 500, price: 249, originalPrice: 389, tag: "Best value" },
  ],
  note: { text: "Ground in small batches · resealable zip pouch", tone: "fresh" },
  productInformation: [
    { label: "Ingredients", value: "100% moringa (drumstick) leaves" },
    { label: "Net quantity", value: "100 g / 250 g / 500 g" },
    { label: "Shelf life", value: "Best within 6 months" },
    { label: "Storage", value: "Cool, dry place; close the pouch after use" },
    { label: "Country of origin", value: "India" },
    { label: "Manufactured by", value: "Chiranvi Farm, [add address]" },
    { label: "FSSAI Lic. No.", value: "[add number]" },
  ],
  nutritionFacts: [
    { label: "Energy", value: "205 kcal" },
    { label: "Protein", value: "27 g" },
    { label: "Total fat", value: "2 g" },
    { label: "Carbohydrate", value: "38 g" },
    { label: "Dietary fibre", value: "19 g" },
  ],
};

/*
  Menthya Mudde Powder (picture from its ad, cropped) and Millet Ganji Powder (the flours picture until its
  own is uploaded). Starting prices; the real ones, the ingredients and nutrition are set in the Chiranvi
  Panel (Products & pricing → Edit page).
*/
const menthyaMuddePage: OneTimeProductPage = {
  ...moringaPage,
  slug: "menthya-mudde-powder",
  cardNote: "ready mix",
  name: "Menthya Mudde Powder",
  tagline: "Just Add Hot Water, Shape & Enjoy",
  description:
    "A traditional menthya (fenugreek) mudde mix, ground in small batches. Stir into hot water, shape into soft mudde and enjoy with saaru or curry.",
  badge: { text: "Traditional mix", colour: "cream" },
  rating: { score: "4.6", count: "(new)" },
  ratingNote: "Small-batch ground",
  highlights: ["Ready mix", "Just add hot water", "No added colour", "No preservatives"],
  pictures: [
    { imageSource: "/images/products/menthya-mudde-powder-pouch.webp", imageWidth: 677, imageHeight: 670, alt: "Chiranvi Farm menthya mudde powder pouch with a bowl of powder" },
  ],
  pictureFit: { widthPercent: 66, heightPercent: 84 },
  packs: [
    { packId: "500-g", label: "500 g", size: 500, price: 149 },
    { packId: "1-kg", label: "1 kg", size: 1000, price: 279, tag: "Best value" },
  ],
  defaultPackId: "1-kg",
  note: { text: "Ground in small batches · resealable zip pouch", tone: "fresh" },
  productInformation: moringaPage.productInformation.map((row) =>
    row.label === "Ingredients"
      ? { ...row, value: "Menthya (fenugreek) mudde mix [add the ingredients]" }
      : row.label === "Net quantity"
        ? { ...row, value: "500 g / 1 kg" }
        : row,
  ),
  nutritionFacts: [],
  nutritionBasis: "",
};

const milletGanjiPage: OneTimeProductPage = {
  ...menthyaMuddePage,
  slug: "millet-ganji-powder",
  cardNote: "porridge mix",
  name: "Millet Ganji Powder",
  tagline: "A Warm, Wholesome Millet Porridge",
  description:
    "A wholesome millet ganji mix, ground in small batches. Cook with water or milk for a warm, filling porridge for breakfast or an evening meal.",
  badge: { text: "Millet goodness", colour: "green" },
  highlights: ["Millets", "Small-batch ground", "No added sugar", "No preservatives"],
  pictures: [
    { imageSource: "/images/categories/flours-category-chiranvi-farm.webp", imageWidth: 412, imageHeight: 276, alt: "Chiranvi Farm millet ganji powder" },
  ],
  pictureFit: { widthPercent: 78, heightPercent: 88 },
  packs: [
    { packId: "500-g", label: "500 g", size: 500, price: 129 },
    { packId: "1-kg", label: "1 kg", size: 1000, price: 239, tag: "Best value" },
  ],
  productInformation: menthyaMuddePage.productInformation.map((row) =>
    row.label === "Ingredients" ? { ...row, value: "Millets [add the millets used]" } : row,
  ),
};

/*
  Instant Noodles, Pasta and Macaroni: six flavours each, one page per flavour (18 pages), each under its own
  All products category. One 250 g pack at ₹120 for now; the real prices, ingredients and nutrition are set in
  the Chiranvi Panel (Products & pricing → Edit page). The pictures are cut from the pack designs (small for
  now; replace them in the panel when the full-size photos come).
*/
type NoodleFlavour = { id: string; name: string };
const NOODLE_FLAVOURS: NoodleFlavour[] = [
  { id: "carrot", name: "Carrot" },
  { id: "beetroot", name: "Beetroot" },
  { id: "tomato", name: "Tomato" },
  { id: "palak", name: "Palak" },
  { id: "ragi", name: "Ragi" },
  { id: "millet", name: "Millet" },
];

const noodlesAndPastaTemplate: OneTimeProductPage = {
  ...moringaPage,
  rating: { score: "4.5", count: "(new)" },
  ratingNote: "Made with natural ingredients",
  packs: [{ packId: "250-g", label: "250 g", size: 250, price: 120 }],
  defaultPackId: "250-g",
  cartPackWord: "pack",
  note: { text: "Homemade · zero preservatives", tone: "fresh" },
  review: { quote: "", name: "", area: "" },
  deliverySteps: [orderByNineStep, { icon: "box", title: "Packed fresh", detail: "From this week’s batch" }, { icon: "home", title: "At your door", detail: "By tomorrow" }],
  nutritionFacts: [],
  nutritionBasis: "",
};

function toNoodlesAndPastaPages(product: {
  kind: "Instant Noodles" | "Pasta" | "Macaroni";
  slugEnd: string; // "instant-noodles"
  pictureFileEnd: string; // "instant-noodles-pack"
  pictureSize: { imageWidth: number; imageHeight: number };
  pictureFit: OneTimeProductPage["pictureFit"];
  shopCategory: ShopCategory;
  tagline: string;
  description: (flavour: string) => string;
}): OneTimeProductPage[] {
  return NOODLE_FLAVOURS.map((flavour) => ({
    ...noodlesAndPastaTemplate,
    slug: `${flavour.id}-${product.slugEnd}`,
    shopCategory: product.shopCategory,
    cardNote: `${flavour.name.toLowerCase()} flavour`,
    name: `${flavour.name} ${product.kind}`,
    tagline: product.tagline,
    description: product.description(flavour.name.toLowerCase()),
    badge: { text: `${flavour.name} flavour`, colour: "cream" },
    highlights: [`${flavour.name} flavour`, "Homemade", "Zero preservatives", "Natural ingredients"],
    pictures: [
      {
        imageSource: `/images/products/${flavour.id}-${product.pictureFileEnd}.webp`,
        ...product.pictureSize,
        alt: `Chiranvi Farm ${flavour.name} ${product.kind} ${product.kind === "Macaroni" ? "label" : "pack"}`,
      },
    ],
    pictureFit: product.pictureFit,
    productInformation: [
      { label: "Ingredients", value: `[add ingredients] · ${flavour.name.toLowerCase()} flavour` },
      { label: "Net quantity", value: "250 g" },
      { label: "Shelf life", value: "[add shelf life]" },
      { label: "Storage", value: "Cool, dry place" },
      { label: "Country of origin", value: "India" },
      { label: "Manufactured by", value: "Chiranvi Farm, [add address]" },
      { label: "FSSAI Lic. No.", value: "[add number]" },
    ],
  }));
}

const instantNoodlesPages = toNoodlesAndPastaPages({
  kind: "Instant Noodles",
  slugEnd: "instant-noodles",
  pictureFileEnd: "instant-noodles-pack",
  pictureSize: { imageWidth: 850, imageHeight: 1000 },
  pictureFit: { widthPercent: 60, heightPercent: 84 },
  shopCategory: "Noodles",
  tagline: "Homemade Noodles, Ready in Minutes",
  description: (flavour) => `Homemade instant noodles with ${flavour} flavour, made with natural ingredients and no preservatives. A quick, tasty meal for kids and grown-ups.`,
});

const pastaPages = toNoodlesAndPastaPages({
  kind: "Pasta",
  slugEnd: "pasta",
  pictureFileEnd: "pasta-pack",
  pictureSize: { imageWidth: 714, imageHeight: 1000 },
  pictureFit: { widthPercent: 56, heightPercent: 84 },
  shopCategory: "Pasta",
  tagline: "Homemade Pasta, Full of Flavour",
  description: (flavour) => `Homemade pasta with ${flavour} flavour, made with natural ingredients and no preservatives. Cook it with your favourite sauce or vegetables.`,
});

const macaroniPages = toNoodlesAndPastaPages({
  kind: "Macaroni",
  slugEnd: "macaroni",
  pictureFileEnd: "macaroni-label",
  pictureSize: { imageWidth: 1000, imageHeight: 1000 },
  pictureFit: { widthPercent: 70, heightPercent: 80 },
  shopCategory: "Macaroni",
  tagline: "Homemade Macaroni, Made Naturally",
  description: (flavour) => `Homemade macaroni with ${flavour} flavour, made with natural ingredients and no preservatives. Great for a quick lunch box or a warm evening snack.`,
});

/*
  Order on the All products page: the three milks, the ghees, paneer, the butters, the attas and flours,
  batter, then the powders, then the noodles, pasta and macaroni. No longer sold: Whole Wheat Atta (Kapti and Jave replace it; its page above is
  their template), Coriander powder (its page is the powders' template), Jowar flour, and Turmeric, Red
  Chilli and Red Sandal powder. The Chiranvi Panel can add any of them again ("Add product").
*/
export const startingProductPages: ProductPage[] = [
  milkPage,
  jerseyMilkPage,
  skimmedMilkPage,
  gheePage,
  jerseyGheePage,
  paneerPage,
  butterPage,
  jerseyButterPage,
  kaptiWheatAttaPage,
  javeWheatAttaPage,
  multigrainAttaPage,
  ragiFlourPage,
  batterPage,
  menthyaMuddePage,
  milletGanjiPage,
  moringaPage,
  ...instantNoodlesPages,
  ...pastaPages,
  ...macaroniPages,
];

// Page address from a product name: "Ragi Flour" → "ragi-flour"
export function toProductSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
