/**
 * User Factory
 *
 * Creates test users, drivers, and riders with realistic African data.
 */

import { faker } from "@faker-js/faker";
import type { TestDriver, TestRider, TestUser } from "../types";
import { PHONE_FORMATS, randomPick, uuid } from "../utils";

// African first names (diverse across regions)
const AFRICAN_FIRST_NAMES = {
  male: [
    "Oluwaseun",
    "Chukwuemeka",
    "Kofi",
    "Kwame",
    "Thabo",
    "Sipho",
    "Okonkwo",
    "Amadi",
    "Chinedu",
    "Emeka",
    "Adebayo",
    "Olumide",
    "Femi",
    "Kunle",
    "Tobi",
    "Damilola",
    "Juma",
    "Wanjala",
    "Otieno",
    "Kamau",
    "Mwangi",
    "Ochieng",
    "Banda",
    "Phiri",
    "Jean-Pierre",
    "Habimana",
    "Mugabo",
    "Niyonzima",
    "Mohamed",
    "Ibrahim",
    "Yusuf",
  ],
  female: [
    "Ngozi",
    "Chioma",
    "Adaeze",
    "Chiamaka",
    "Amara",
    "Adaora",
    "Bukola",
    "Folake",
    "Yetunde",
    "Funke",
    "Tolani",
    "Omolara",
    "Adaobi",
    "Ifeoma",
    "Nkechi",
    "Obiageli",
    "Wanjiku",
    "Akinyi",
    "Njeri",
    "Nyambura",
    "Fatuma",
    "Amina",
    "Zainab",
    "Aisha",
    "Thandi",
    "Nomvula",
    "Lindiwe",
    "Sizani",
    "Marie-Claire",
    "Uwimana",
    "Mukeshimana",
  ],
};

const AFRICAN_LAST_NAMES = [
  "Okonkwo",
  "Adebayo",
  "Nwosu",
  "Chukwuma",
  "Okafor",
  "Eze",
  "Nnamdi",
  "Obi",
  "Odeh",
  "Abubakar",
  "Bello",
  "Mohammed",
  "Suleiman",
  "Usman",
  "Musa",
  "Ibrahim",
  "Mensah",
  "Asante",
  "Boateng",
  "Owusu",
  "Adjei",
  "Appiah",
  "Nyarko",
  "Agyeman",
  "Mutua",
  "Wanjiru",
  "Kimani",
  "Otieno",
  "Ouma",
  "Mwangi",
  "Kipchoge",
  "Kosgei",
  "Nkosi",
  "Dlamini",
  "Ndlovu",
  "Zulu",
  "Mthembu",
  "Khumalo",
  "Sithole",
  "Moyo",
  "Habimana",
  "Uwimana",
  "Niyonzima",
  "Mugabo",
  "Nsabimana",
  "Hakizimana",
];

interface UserFactoryOptions {
  country?: keyof typeof PHONE_FORMATS;
  isVerified?: boolean;
  hasProfilePicture?: boolean;
}

interface DriverFactoryOptions extends UserFactoryOptions {
  isOnline?: boolean;
  vehicleType?: "car" | "motorcycle" | "bicycle" | "tuktuk";
  rating?: number;
}

interface RiderFactoryOptions extends UserFactoryOptions {
  hasSavedPaymentMethod?: boolean;
  preferredPaymentMethod?: "card" | "mobile_money" | "cash";
}

/**
 * Generate a random African name
 */
function generateAfricanName(): { firstName: string; lastName: string } {
  const gender = Math.random() > 0.5 ? "male" : "female";
  const firstName = randomPick(AFRICAN_FIRST_NAMES[gender]);
  const lastName = randomPick(AFRICAN_LAST_NAMES);
  return { firstName, lastName };
}

/**
 * Generate a phone number for a specific country
 */
function generatePhoneNumber(
  country: keyof typeof PHONE_FORMATS = "NG",
): string {
  const format = PHONE_FORMATS[country] || PHONE_FORMATS.NG;
  const number = format.format.replace(/X/g, () =>
    Math.floor(Math.random() * 10).toString(),
  );
  return `${format.code}${number}`;
}

/**
 * Create a base test user
 */
export function createUser(options: UserFactoryOptions = {}): TestUser {
  const {
    country = "NG",
    isVerified = true,
    hasProfilePicture = true,
  } = options;
  const { firstName, lastName } = generateAfricanName();
  const email = faker.internet.email({ firstName, lastName }).toLowerCase();

  return {
    id: uuid(),
    email,
    firstName,
    lastName,
    phone: generatePhoneNumber(country),
    isVerified,
    profilePicture: hasProfilePicture ? faker.image.avatar() : undefined,
    createdAt: faker.date.past(),
    updatedAt: new Date(),
  };
}

/**
 * Create a test driver
 */
export function createDriver(options: DriverFactoryOptions = {}): TestDriver {
  const {
    country = "NG",
    isOnline = true,
    vehicleType = "car",
    rating = faker.number.float({ min: 4.0, max: 5.0, multipleOf: 0.1 }),
    ...userOptions
  } = options;

  const user = createUser({ country, ...userOptions });

  const vehicleModels: Record<string, string[]> = {
    car: [
      "Toyota Corolla",
      "Honda Civic",
      "Toyota Camry",
      "Hyundai Elantra",
      "Kia Rio",
    ],
    motorcycle: [
      "Honda CB",
      "Yamaha FZ",
      "Bajaj Pulsar",
      "TVS Apache",
      "Suzuki Gixxer",
    ],
    bicycle: ["Generic Bike", "Mountain Bike", "City Bike"],
    tuktuk: ["Bajaj RE", "Piaggio Ape", "TVS King"],
  };

  const vehicleColors = [
    "Black",
    "White",
    "Silver",
    "Red",
    "Blue",
    "Grey",
    "Green",
  ];

  return {
    ...user,
    isOnline,
    rating,
    totalRides: faker.number.int({ min: 50, max: 5000 }),
    vehicle: {
      type: vehicleType,
      make: vehicleModels[vehicleType][0].split(" ")[0],
      model: randomPick(vehicleModels[vehicleType]),
      color: randomPick(vehicleColors),
      plateNumber: `${faker.string.alpha({ length: 3 }).toUpperCase()}-${faker.string.numeric({ length: 3 })}${faker.string.alpha({ length: 2 }).toUpperCase()}`,
      year: faker.number.int({ min: 2015, max: 2024 }),
    },
    location: {
      latitude: faker.location.latitude(),
      longitude: faker.location.longitude(),
    },
    documents: {
      driversLicense: `DL-${faker.string.alphanumeric({ length: 12 }).toUpperCase()}`,
      vehicleRegistration: `VR-${faker.string.alphanumeric({ length: 10 }).toUpperCase()}`,
      insurance: `INS-${faker.string.alphanumeric({ length: 8 }).toUpperCase()}`,
    },
  };
}

/**
 * Create a test rider
 */
export function createRider(options: RiderFactoryOptions = {}): TestRider {
  const {
    country = "NG",
    hasSavedPaymentMethod = true,
    preferredPaymentMethod = "mobile_money",
    ...userOptions
  } = options;

  const user = createUser({ country, ...userOptions });
  const currency = country === "NG" ? "NGN" : country === "KE" ? "KES" : "GHS";

  return {
    ...user,
    preferredPaymentMethod,
    savedPaymentMethods: hasSavedPaymentMethod
      ? [
          {
            id: uuid(),
            type: preferredPaymentMethod,
            isDefault: true,
            ...(preferredPaymentMethod === "card"
              ? {
                  last4: faker.finance.creditCardNumber().slice(-4),
                  brand: randomPick(["visa", "mastercard"]),
                  expiryMonth: faker.number.int({ min: 1, max: 12 }),
                  expiryYear: faker.number.int({ min: 2025, max: 2030 }),
                }
              : preferredPaymentMethod === "mobile_money"
                ? {
                    provider: randomPick([
                      "mpesa",
                      "mtn_momo",
                      "airtel_money",
                      "opay",
                    ]),
                    phoneNumber: generatePhoneNumber(country),
                  }
                : {}),
          },
        ]
      : [],
    homeAddress: {
      id: uuid(),
      name: "Home",
      address: faker.location.streetAddress(),
      latitude: faker.location.latitude(),
      longitude: faker.location.longitude(),
    },
    workAddress: {
      id: uuid(),
      name: "Work",
      address: faker.location.streetAddress(),
      latitude: faker.location.latitude(),
      longitude: faker.location.longitude(),
    },
    totalRides: faker.number.int({ min: 0, max: 200 }),
    walletBalance: faker.number.int({ min: 0, max: 50000 }),
    currency,
  };
}

/**
 * Create multiple users
 */
export function createUsers(
  count: number,
  options?: UserFactoryOptions,
): TestUser[] {
  return Array.from({ length: count }, () => createUser(options));
}

/**
 * Create multiple drivers
 */
export function createDrivers(
  count: number,
  options?: DriverFactoryOptions,
): TestDriver[] {
  return Array.from({ length: count }, () => createDriver(options));
}

/**
 * Create multiple riders
 */
export function createRiders(
  count: number,
  options?: RiderFactoryOptions,
): TestRider[] {
  return Array.from({ length: count }, () => createRider(options));
}
