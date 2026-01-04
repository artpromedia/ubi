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
		"Thabo", "Lindiwe", "Sipho", "Nomsa", "Mandla",
		"Njeri", "Kamau", "Wanjiku", "Odhiambo", "Akinyi",
	}

	lastNames = []string{
		"Okonkwo", "Eze", "Adeyemi", "Okoro", "Nnamdi",
		"Obi", "Chukwu", "Abubakar", "Danjuma", "Bello",
		"Nkosi", "Dlamini", "Ndlovu", "Zulu", "Khumalo",
		"Kimani", "Mwangi", "Ochieng", "Wanjiru", "Otieno",
	}

	nigerianPrefixes = []string{
		"0701", "0702", "0703", "0704", "0705", "0706", "0707", "0708", "0709",
		"0802", "0803", "0804", "0805", "0806", "0807", "0808", "0809",
		"0810", "0811", "0812", "0813", "0814", "0815", "0816", "0817", "0818", "0819",
		"0901", "0902", "0903", "0904", "0905", "0906", "0907", "0908", "0909",
	}

	kenyanPrefixes = []string{
		"0700", "0701", "0702", "0703", "0704", "0705", "0706", "0707", "0708", "0709",
		"0710", "0711", "0712", "0713", "0714", "0715", "0716", "0717", "0718", "0719",
		"0720", "0721", "0722", "0723", "0724", "0725", "0726", "0727", "0728", "0729",
	}

	southAfricanPrefixes = []string{
		"060", "061", "062", "063", "064", "065", "066", "067", "068", "069",
		"071", "072", "073", "074", "076", "078", "079",
		"081", "082", "083", "084",
	}

	vehicleMakes = []string{"Toyota", "Honda", "Nissan", "Hyundai", "Kia", "Suzuki", "Mazda", "Volkswagen"}

	vehicleModels = map[string][]string{
		"Toyota":     {"Corolla", "Camry", "RAV4", "Yaris", "Hilux", "Prius"},
		"Honda":      {"Civic", "Accord", "CR-V", "Fit", "HR-V"},
		"Nissan":     {"Sunny", "Altima", "X-Trail", "Micra", "Qashqai"},
		"Hyundai":    {"Elantra", "Accent", "Tucson", "i10", "i20"},
		"Kia":        {"Rio", "Sportage", "Seltos", "Picanto", "Cerato"},
		"Suzuki":     {"Swift", "Baleno", "Vitara", "Alto", "Dzire"},
		"Mazda":      {"3", "CX-5", "6", "CX-30", "2"},
		"Volkswagen": {"Polo", "Golf", "Tiguan", "Jetta", "Passat"},
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

// GenerateKenyanPhone generates a random Kenyan phone number
func GenerateKenyanPhone() string {
	prefix := kenyanPrefixes[rand.Intn(len(kenyanPrefixes))]
	return "+254" + prefix[1:] + randomDigits(6)
}

// GenerateSouthAfricanPhone generates a random South African phone number
func GenerateSouthAfricanPhone() string {
	prefix := southAfricanPrefixes[rand.Intn(len(southAfricanPrefixes))]
	return "+27" + prefix[1:] + randomDigits(7)
}

// GeneratePhone generates a phone number for a given country
func GeneratePhone(country string) string {
	switch country {
	case "NG":
		return GenerateNigerianPhone()
	case "KE":
		return GenerateKenyanPhone()
	case "ZA":
		return GenerateSouthAfricanPhone()
	default:
		return GenerateNigerianPhone()
	}
}

// RandomVehicle returns a random vehicle make and model
func RandomVehicle() (make string, model string, year int) {
	make = vehicleMakes[rand.Intn(len(vehicleMakes))]
	models := vehicleModels[make]
	model = models[rand.Intn(len(models))]
	year = 2015 + rand.Intn(10) // 2015-2024
	return
}

// RandomLicensePlate generates a random Nigerian license plate
func RandomLicensePlate() string {
	states := []string{"LAG", "ABJ", "KAN", "RIV", "OYO", "EDO", "OGU", "ANA"}
	state := states[rand.Intn(len(states))]
	return state + "-" + randomDigits(3) + randomLetters(2)
}

// RandomLocation generates a random location near a center point
func RandomLocation(centerLat, centerLng, radiusKm float64) (lat, lng float64) {
	// Simple approximation: 1 degree ~ 111km
	radiusDegrees := radiusKm / 111.0

	lat = centerLat + (rand.Float64()*2-1)*radiusDegrees
	lng = centerLng + (rand.Float64()*2-1)*radiusDegrees
	return
}

// RandomFare generates a random fare in the smallest currency unit
func RandomFare(minAmount, maxAmount int64) int64 {
	return minAmount + rand.Int63n(maxAmount-minAmount)
}

// RandomRating generates a random rating between 1 and 5
func RandomRating() float64 {
	// Weighted towards higher ratings (more realistic)
	weights := []float64{0.02, 0.03, 0.10, 0.35, 0.50}
	r := rand.Float64()
	cumulative := 0.0
	for i, w := range weights {
		cumulative += w
		if r < cumulative {
			// Add some decimal variation
			return float64(i+1) + rand.Float64()*0.5
		}
	}
	return 5.0
}

// RandomDuration generates a random duration in seconds
func RandomDuration(minMinutes, maxMinutes int) int {
	return (minMinutes + rand.Intn(maxMinutes-minMinutes)) * 60
}

// RandomDistance generates a random distance in meters
func RandomDistance(minKm, maxKm int) int {
	return (minKm + rand.Intn(maxKm-minKm)) * 1000
}

// Helper functions

func randomDigits(n int) string {
	digits := make([]byte, n)
	for i := range digits {
		digits[i] = byte('0' + rand.Intn(10))
	}
	return string(digits)
}

func randomLetters(n int) string {
	letters := make([]byte, n)
	for i := range letters {
		letters[i] = byte('A' + rand.Intn(26))
	}
	return string(letters)
}

// RandomString generates a random alphanumeric string
func RandomString(n int) string {
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := make([]byte, n)
	for i := range result {
		result[i] = chars[rand.Intn(len(chars))]
	}
	return string(result)
}

// RandomUUID generates a random UUID-like string (not cryptographically secure)
func RandomUUID() string {
	return RandomString(8) + "-" + RandomString(4) + "-" + RandomString(4) + "-" + RandomString(4) + "-" + RandomString(12)
}
