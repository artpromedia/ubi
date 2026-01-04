package testutil

import (
	"math/rand"
	"time"
)

var (
	firstNames = []string{
		"Chidi", "Amara", "Oluwaseun", "Ngozi", "Emeka",
		"Adaeze", "Chisom", "Obiora", "Nneka", "Ikenna",
		"Fatima", "Ahmed", "Aisha", "Ibrahim", "Zainab",
		"Musa", "Halima", "Abdullahi", "Amina", "Yusuf",
	}

	lastNames = []string{
		"Okonkwo", "Eze", "Adeyemi", "Okoro", "Nnamdi",
		"Obi", "Chukwu", "Abubakar", "Danjuma", "Bello",
	}

	nigerianPrefixes = []string{
		"0701", "0702", "0703", "0802", "0803", "0805",
		"0806", "0807", "0808", "0809", "0810", "0811",
		"0812", "0813", "0814", "0815", "0816", "0817",
	}

	foodItems = []string{
		"Jollof Rice", "Fried Rice", "Egusi Soup", "Pounded Yam",
		"Suya", "Pepper Soup", "Moi Moi", "Amala", "Ewedu",
		"Ofada Rice", "Asun", "Gizdodo", "Plantain", "Chicken",
	}
)

func init() {
	rand.Seed(time.Now().UnixNano())
}

// RandomFirstName returns a random African first name
func RandomFirstName() string {
	return firstNames[rand.Intn(len(firstNames))]
}

// RandomLastName returns a random African last name
func RandomLastName() string {
	return lastNames[rand.Intn(len(lastNames))]
}

// GenerateNigerianPhone generates a random Nigerian phone number
func GenerateNigerianPhone() string {
	prefix := nigerianPrefixes[rand.Intn(len(nigerianPrefixes))]
	return "+234" + prefix[1:] + randomDigits(7)
}

// RandomFoodItem returns a random food item
func RandomFoodItem() string {
	return foodItems[rand.Intn(len(foodItems))]
}

// RandomFoodItems returns multiple random food items
func RandomFoodItems(count int) []DeliveryItemFixture {
	items := make([]DeliveryItemFixture, count)
	for i := 0; i < count; i++ {
		items[i] = DeliveryItemFixture{
			ID:       RandomUUID(),
			Name:     RandomFoodItem(),
			Quantity: 1 + rand.Intn(3),
			Price:    RandomPrice(50000, 500000), // 500-5000 NGN
			Notes:    "",
		}
	}
	return items
}

// RandomPrice generates a random price in kobo
func RandomPrice(min, max int64) int64 {
	return min + rand.Int63n(max-min)
}

// RandomRating generates a random rating between 3.5 and 5.0
func RandomRating() float64 {
	return 3.5 + rand.Float64()*1.5
}

// RandomDuration generates a random duration in minutes
func RandomDuration(minMinutes, maxMinutes int) int {
	return minMinutes + rand.Intn(maxMinutes-minMinutes)
}

// RandomLocation generates a random location near a center point
func RandomLocation(centerLat, centerLng, radiusKm float64) (lat, lng float64) {
	radiusDegrees := radiusKm / 111.0
	lat = centerLat + (rand.Float64()*2-1)*radiusDegrees
	lng = centerLng + (rand.Float64()*2-1)*radiusDegrees
	return
}

// Helper functions

func randomDigits(n int) string {
	digits := make([]byte, n)
	for i := range digits {
		digits[i] = byte('0' + rand.Intn(10))
	}
	return string(digits)
}

// RandomString generates a random alphanumeric string
func RandomString(n int) string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := make([]byte, n)
	for i := range result {
		result[i] = chars[rand.Intn(len(chars))]
	}
	return string(result)
}

// RandomUUID generates a random UUID-like string
func RandomUUID() string {
	return RandomString(8) + "-" + RandomString(4) + "-" + RandomString(4) + "-" + RandomString(4) + "-" + RandomString(12)
}
