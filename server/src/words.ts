import type { Food, Language } from "./model";

export const words = {
  en: {
    home: "My fridges", food: "Food in the fridge", devices: "Devices", signIn: "Sign in with Google",
    signOut: "Sign out", setup: "The dashboard needs Firebase setup.", loading: "Loading…",
    failed: "Couldn’t load this information. Try refreshing the page.", missingFridge: "This fridge is unavailable.",
    emptyFridges: "No fridges yet. Ask the fridge owner to give your Google account access.",
    welcome: "See what’s in your fridge and how it’s doing.", addFood: "Add food", emptyFood: "No food has been added yet.",
    temperature: "Temperature", voc: "Air quality", light: "Fridge light", history: "Last hour", noHistory: "No recent readings",
    sensor: "Sensor", lastReading: "Last reading", waitingReadings: "Waiting for the first sensor reading.",
    deviceIntro: "The gateway checks in with the fridge sensor and door closer.",
    gateway: "Camera and gateway", fridgeSensor: "Fridge sensor", doorCloser: "Door closer", otherDevice: "Device",
    lastActive: "Last seen", reportedTime: "Time in latest report", lastReport: "Last gateway report", unknown: "No record yet",
    recent: "Recently seen", stale: "No recent contact", unreported: "Not seen since gateway started",
    notIncluded: "Not in the latest report", waiting: "Waiting for first report", gatewayMissing: "Gateway hasn’t checked in",
    itemMissing: "This item is no longer in the fridge.", expiry: "Expires", duplicates: "Other matching items",
    matching: "Same name and expiry date", itemNumber: "Item", noPhoto: "No photo for this item.",
    photoError: "Couldn’t open this photo.", name: "Food name", category: "Category",
    optionalPhoto: "Photo (optional)", pickPhoto: "Choose photo", takePhoto: "Take photo", removePhoto: "Remove photo",
    save: "Save food", saving: "Saving…", cancel: "Cancel", saved: "Food added",
    saveError: "Couldn’t save the food. Please try again.", fileError: "Choose a photo your browser can open.",
    expiryHelp: "Choose the date on the package or your best estimate.",
  },
  th: {
    home: "ตู้เย็นของฉัน", food: "อาหารในตู้เย็น", devices: "อุปกรณ์", signIn: "เข้าสู่ระบบด้วย Google",
    signOut: "ออกจากระบบ", setup: "ต้องตั้งค่า Firebase ก่อนใช้งาน", loading: "กำลังโหลด…",
    failed: "โหลดข้อมูลไม่ได้ ลองรีเฟรชหน้านี้", missingFridge: "เปิดตู้เย็นนี้ไม่ได้",
    emptyFridges: "ยังไม่มีตู้เย็น ให้เจ้าของตู้เย็นเพิ่มบัญชี Google ของคุณ",
    welcome: "ดูอาหารและสถานะตู้เย็นของคุณ", addFood: "เพิ่มอาหาร", emptyFood: "ยังไม่มีอาหารในรายการ",
    temperature: "อุณหภูมิ", voc: "คุณภาพอากาศ", light: "แสงในตู้เย็น", history: "1 ชั่วโมงล่าสุด", noHistory: "ไม่มีข้อมูลล่าสุด",
    sensor: "เซนเซอร์", lastReading: "ข้อมูลล่าสุด", waitingReadings: "กำลังรอข้อมูลจากเซนเซอร์",
    deviceIntro: "เกตเวย์รับข้อมูลจากเซนเซอร์ตู้เย็นและชุดปิดประตู",
    gateway: "กล้องและเกตเวย์", fridgeSensor: "เซนเซอร์ตู้เย็น", doorCloser: "ชุดปิดประตู", otherDevice: "อุปกรณ์",
    lastActive: "ติดต่อได้ล่าสุด", reportedTime: "เวลาในรายงานล่าสุด", lastReport: "รายงานจากเกตเวย์ล่าสุด", unknown: "ยังไม่มีข้อมูล",
    recent: "ติดต่อได้เมื่อไม่นานมานี้", stale: "ไม่ได้รับข้อมูลล่าสุด", unreported: "ยังไม่พบหลังเกตเวย์เริ่มทำงาน",
    notIncluded: "ไม่มีในรายงานล่าสุด", waiting: "กำลังรอรายงานแรก", gatewayMissing: "เกตเวย์ยังไม่ได้ส่งรายงานล่าสุด",
    itemMissing: "อาหารชิ้นนี้ไม่อยู่ในรายการแล้ว", expiry: "หมดอายุ", duplicates: "ชิ้นอื่นที่ตรงกัน",
    matching: "ชื่อและวันหมดอายุเดียวกัน", itemNumber: "ชิ้นที่", noPhoto: "อาหารชิ้นนี้ไม่มีรูป",
    photoError: "เปิดรูปไม่ได้", name: "ชื่ออาหาร", category: "หมวดหมู่",
    optionalPhoto: "รูปอาหาร (ไม่บังคับ)", pickPhoto: "เลือกรูป", takePhoto: "ถ่ายรูป", removePhoto: "ลบรูป",
    save: "บันทึกอาหาร", saving: "กำลังบันทึก…", cancel: "ยกเลิก", saved: "เพิ่มอาหารแล้ว",
    saveError: "บันทึกอาหารไม่ได้ ลองอีกครั้ง", fileError: "เลือกรูปที่เบราว์เซอร์เปิดได้",
    expiryHelp: "เลือกวันที่บนฉลากหรือวันที่คาดว่าจะหมดอายุ",
  },
} satisfies Record<Language, Record<string, string>>;

export const categories = {
  Dairy: "นมและผลิตภัณฑ์นม", Produce: "ผักและผลไม้", Meat: "เนื้อสัตว์", Seafood: "อาหารทะเล",
  Beverage: "เครื่องดื่ม", Condiments: "เครื่องปรุงและซอส", Leftovers: "อาหารปรุงสุก",
  Bakery: "เบเกอรี่และขนมปัง", Snacks: "ขนมขบเคี้ยว", Other: "อื่น ๆ",
};

export function categoryLabel(category: string, language: Language): string {
  return language === "th" && Object.hasOwn(categories, category)
    ? categories[category as keyof typeof categories] : category;
}

export function foodName(food: Food, language: Language): string {
  return (language === "th" ? food.nameTh || food.nameEn : food.nameEn || food.nameTh) || "—";
}
