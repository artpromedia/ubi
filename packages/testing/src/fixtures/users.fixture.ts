/**
 * User Fixtures
 *
 * Pre-defined test users for consistent testing scenarios.
 */

import type { TestDriver, TestRider, TestUser } from "../types";

/**
 * Standard test users for common scenarios
 */
export const TEST_USERS: Record<string, TestUser> = {
  // Nigerian users
  CHUKWUEMEKA: {
    id: "user_ng_001",
    email: "chukwuemeka@test.ubi.com",
    firstName: "Chukwuemeka",
    lastName: "Okonkwo",
    phone: "+2348012345678",
    isVerified: true,
    profilePicture: "https://randomuser.me/api/portraits/men/1.jpg",
    createdAt: new Date("2024-01-15"),
    updatedAt: new Date("2024-06-01"),
  },
  NGOZI: {
    id: "user_ng_002",
    email: "ngozi@test.ubi.com",
    firstName: "Ngozi",
    lastName: "Adaeze",
    phone: "+2348087654321",
    isVerified: true,
    profilePicture: "https://randomuser.me/api/portraits/women/1.jpg",
    createdAt: new Date("2024-02-20"),
    updatedAt: new Date("2024-06-01"),
  },

  // Kenyan users
  WANJIKU: {
    id: "user_ke_001",
    email: "wanjiku@test.ubi.com",
    firstName: "Wanjiku",
    lastName: "Kamau",
    phone: "+254712345678",
    isVerified: true,
    profilePicture: "https://randomuser.me/api/portraits/women/2.jpg",
    createdAt: new Date("2024-03-10"),
    updatedAt: new Date("2024-06-01"),
  },
  OTIENO: {
    id: "user_ke_002",
    email: "otieno@test.ubi.com",
    firstName: "Otieno",
    lastName: "Ochieng",
    phone: "+254798765432",
    isVerified: true,
    profilePicture: "https://randomuser.me/api/portraits/men/2.jpg",
    createdAt: new Date("2024-03-15"),
    updatedAt: new Date("2024-06-01"),
  },

  // Unverified user for testing verification flows
  UNVERIFIED: {
    id: "user_unverified_001",
    email: "unverified@test.ubi.com",
    firstName: "Test",
    lastName: "Unverified",
    phone: "+2348000000000",
    isVerified: false,
    createdAt: new Date("2024-06-01"),
    updatedAt: new Date("2024-06-01"),
  },
};

/**
 * Standard test drivers
 */
export const TEST_DRIVERS: Record<string, TestDriver> = {
  EMEKA_DRIVER: {
    id: "driver_ng_001",
    email: "emeka.driver@test.ubi.com",
    firstName: "Emeka",
    lastName: "Nwosu",
    phone: "+2348055555555",
    isVerified: true,
    profilePicture: "https://randomuser.me/api/portraits/men/3.jpg",
    createdAt: new Date("2023-06-01"),
    updatedAt: new Date("2024-06-01"),
    isOnline: true,
    rating: 4.8,
    totalRides: 2547,
    vehicle: {
      type: "car",
      make: "Toyota",
      model: "Toyota Corolla",
      color: "Silver",
      plateNumber: "ABC-123XY",
      year: 2020,
    },
    location: {
      latitude: 6.5244,
      longitude: 3.3792,
    },
    documents: {
      driversLicense: "DL-NG-123456789",
      vehicleRegistration: "VR-NG-987654321",
      insurance: "INS-NG-111222333",
    },
  },

  KAMAU_BODA: {
    id: "driver_ke_001",
    email: "kamau.boda@test.ubi.com",
    firstName: "Kamau",
    lastName: "Mwangi",
    phone: "+254711111111",
    isVerified: true,
    profilePicture: "https://randomuser.me/api/portraits/men/4.jpg",
    createdAt: new Date("2023-08-15"),
    updatedAt: new Date("2024-06-01"),
    isOnline: true,
    rating: 4.9,
    totalRides: 4821,
    vehicle: {
      type: "motorcycle",
      make: "Honda",
      model: "Honda CB",
      color: "Red",
      plateNumber: "KMCU-456",
      year: 2022,
    },
    location: {
      latitude: -1.2921,
      longitude: 36.8219,
    },
    documents: {
      driversLicense: "DL-KE-ABC123456",
      vehicleRegistration: "VR-KE-XYZ789012",
      insurance: "INS-KE-DEF345678",
    },
  },

  OFFLINE_DRIVER: {
    id: "driver_offline_001",
    email: "offline.driver@test.ubi.com",
    firstName: "Offline",
    lastName: "Driver",
    phone: "+2348099999999",
    isVerified: true,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-06-01"),
    isOnline: false,
    rating: 4.5,
    totalRides: 150,
    vehicle: {
      type: "car",
      make: "Hyundai",
      model: "Hyundai Elantra",
      color: "White",
      plateNumber: "DEF-789AB",
      year: 2019,
    },
    location: {
      latitude: 6.4541,
      longitude: 3.3947,
    },
    documents: {
      driversLicense: "DL-NG-OFFLINE001",
      vehicleRegistration: "VR-NG-OFFLINE001",
      insurance: "INS-NG-OFFLINE001",
    },
  },
};

/**
 * Standard test riders
 */
export const TEST_RIDERS: Record<string, TestRider> = {
  ADAOBI_RIDER: {
    id: "rider_ng_001",
    email: "adaobi@test.ubi.com",
    firstName: "Adaobi",
    lastName: "Eze",
    phone: "+2348066666666",
    isVerified: true,
    profilePicture: "https://randomuser.me/api/portraits/women/3.jpg",
    createdAt: new Date("2024-01-20"),
    updatedAt: new Date("2024-06-01"),
    preferredPaymentMethod: "mobile_money",
    savedPaymentMethods: [
      {
        id: "pm_001",
        type: "mobile_money",
        isDefault: true,
        mobileMoney: {
          provider: "opay",
          providerName: "OPay",
          phoneNumber: "+2348066666666",
          accountName: "Adaobi Eze",
        },
      },
      {
        id: "pm_002",
        type: "card",
        isDefault: false,
        card: {
          brand: "verve",
          last4: "1234",
          expiryMonth: 12,
          expiryYear: 2026,
          cardholderName: "ADAOBI EZE",
        },
      },
    ],
    homeAddress: {
      id: "loc_001",
      name: "Home",
      address: "15 Victoria Island, Lagos",
      latitude: 6.4281,
      longitude: 3.4219,
    },
    workAddress: {
      id: "loc_002",
      name: "Work",
      address: "Ikeja City Mall, Lagos",
      latitude: 6.6018,
      longitude: 3.3515,
    },
    totalRides: 127,
    walletBalance: 15000,
    currency: "NGN",
  },

  NJERI_RIDER: {
    id: "rider_ke_001",
    email: "njeri@test.ubi.com",
    firstName: "Njeri",
    lastName: "Wanjiru",
    phone: "+254722222222",
    isVerified: true,
    profilePicture: "https://randomuser.me/api/portraits/women/4.jpg",
    createdAt: new Date("2024-02-10"),
    updatedAt: new Date("2024-06-01"),
    preferredPaymentMethod: "mobile_money",
    savedPaymentMethods: [
      {
        id: "pm_003",
        type: "mobile_money",
        isDefault: true,
        mobileMoney: {
          provider: "mpesa",
          providerName: "M-Pesa",
          phoneNumber: "+254722222222",
          accountName: "Njeri Wanjiru",
        },
      },
    ],
    homeAddress: {
      id: "loc_003",
      name: "Home",
      address: "Kilimani, Nairobi",
      latitude: -1.2864,
      longitude: 36.7834,
    },
    workAddress: {
      id: "loc_004",
      name: "Work",
      address: "Westlands, Nairobi",
      latitude: -1.2635,
      longitude: 36.8026,
    },
    totalRides: 89,
    walletBalance: 5000,
    currency: "KES",
  },

  NEW_RIDER: {
    id: "rider_new_001",
    email: "newrider@test.ubi.com",
    firstName: "New",
    lastName: "Rider",
    phone: "+2348077777777",
    isVerified: true,
    createdAt: new Date("2024-06-01"),
    updatedAt: new Date("2024-06-01"),
    preferredPaymentMethod: "cash",
    savedPaymentMethods: [],
    totalRides: 0,
    walletBalance: 0,
    currency: "NGN",
  },
};

/**
 * Authentication test tokens (for testing purposes only)
 */
export const TEST_AUTH_TOKENS = {
  VALID_TOKEN:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyX25nXzAwMSIsImlhdCI6MTcxNzIwMDAwMCwiZXhwIjoxNzE3Mjg2NDAwfQ.test_signature",
  EXPIRED_TOKEN:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyX25nXzAwMSIsImlhdCI6MTYwOTQ1OTIwMCwiZXhwIjoxNjA5NTQ1NjAwfQ.test_signature",
  INVALID_TOKEN: "invalid.token.here",
  DRIVER_TOKEN:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkcml2ZXJfbmdfMDAxIiwicm9sZSI6ImRyaXZlciIsImlhdCI6MTcxNzIwMDAwMH0.test_signature",
  ADMIN_TOKEN:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbl8wMDEiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3MTcyMDAwMDB9.test_signature",
};
