import {
  ArrowUpRight,
  Car,
  Utensils,
  Package,
  Plane,
  Sparkles,
  ShieldCheck,
  Wallet,
  Route,
  Smartphone,
} from "lucide-react";

function configuredUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
const rider = configuredUrl(process.env.UBI_RIDER_URL);
const driver = configuredUrl(process.env.UBI_DRIVER_URL);
const ios = configuredUrl(process.env.UBI_IOS_STORE_URL);
const android = configuredUrl(process.env.UBI_ANDROID_STORE_URL);
const privacy = configuredUrl(process.env.UBI_PRIVACY_URL);
const terms = configuredUrl(process.env.UBI_TERMS_URL);
const services = [
  {
    name: "Move",
    text: "Across town. On with your day.",
    icon: Car,
    color: "mint",
    detail: "Find your next ride and review the fare before you confirm.",
  },
  {
    name: "Bites",
    text: "Good food. Less running around.",
    icon: Utensils,
    color: "peach",
    detail: "Explore food delivery where available in the UBI app.",
  },
  {
    name: "Send",
    text: "A little less on your to-do list.",
    icon: Package,
    color: "blue",
    detail: "Arrange a package delivery where the service is available.",
  },
];
const faqs = [
  [
    "Where can I use UBI?",
    "Service availability depends on your city. Check the UBI app before planning a ride or delivery. We only publish confirmed launch locations.",
  ],
  [
    "How do driver commissions and promotions work?",
    "Commission rates and incentives depend on your market and the applicable offer. Review eligibility, dates, limits and the final breakdown in the app before participating.",
  ],
  [
    "Can Ask UBI make a booking for me?",
    "Where enabled, Ask UBI helps you plan a request. Review the price and transaction details before confirming. Available actions depend on your location and account.",
  ],
  [
    "Are flights and hotels available everywhere?",
    "Travel features are being introduced by market. Availability, prices and cancellation conditions depend on the provider and are shown before checkout.",
  ],
];
export default function HomePage() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="header wrap">
        <a href="/" aria-label="UBI home">
          <img src="/ubi-logo-black.svg" width="80" height="40" alt="UBI" />
        </a>
        <nav aria-label="Main navigation">
          <a href="#services">Explore UBI</a>
          <a href="#drive">For drivers</a>
          <a href="#questions">Questions</a>
        </nav>
        <a className="button small" href="#get-ubi">
          Get UBI <ArrowUpRight size={17} />
        </a>
      </header>
      <main id="main">
        <section className="hero wrap">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="dot" /> YOUR CITY. YOUR EVERYDAY.
            </p>
            <h1>
              Life moves.
              <br />
              Move with <em>UBI.</em>
            </h1>
            <p className="lead">
              Your next ride. Your favourite meal. That package you need to
              send. Make room for more of your day.
            </p>
            <div className="actions">
              <a className="button" href={rider || "#get-ubi"}>
                {rider ? "Open UBI" : "Explore the app"}
                <ArrowUpRight size={20} />
              </a>
              <a className="text-link" href="#drive">
                Drive with UBI <ArrowUpRight size={18} />
              </a>
            </div>
            <p className="quiet">
              Built for everyday journeys across Africa.
              <br />
              Services vary by city.
            </p>
          </div>
          <div
            className="journey-art"
            role="img"
            aria-label="Illustration of a journey through the city"
          >
            <div className="art-top">
              <span>MAKE YOUR NEXT MOVE</span>
              <span>↗</span>
            </div>
            <svg viewBox="0 0 600 520" aria-hidden="true">
              <defs>
                <pattern
                  id="blocks"
                  width="130"
                  height="105"
                  patternTransform="rotate(-18)"
                  patternUnits="userSpaceOnUse"
                >
                  <rect
                    x="12"
                    y="12"
                    width="104"
                    height="79"
                    rx="14"
                    fill="#d8e5cf"
                  />
                </pattern>
              </defs>
              <rect width="600" height="520" fill="url(#blocks)" />
              <path
                d="M450 -30 Q300 160 430 260 T330 550"
                fill="none"
                stroke="#bdd8ce"
                strokeWidth="58"
              />
              <path
                d="M95 410 L210 365 L165 225 L350 165 L315 60"
                fill="none"
                stroke="#fffdf4"
                strokeWidth="28"
                strokeLinejoin="round"
              />
              <path
                d="M95 410 L210 365 L165 225 L350 165 L315 60"
                fill="none"
                stroke="#167a48"
                strokeWidth="7"
                strokeLinejoin="round"
                strokeDasharray="12 7"
              />
              <circle
                cx="95"
                cy="410"
                r="17"
                fill="#173c2e"
                stroke="white"
                strokeWidth="6"
              />
              <circle
                cx="315"
                cy="60"
                r="17"
                fill="#173c2e"
                stroke="white"
                strokeWidth="6"
              />
            </svg>
            <div className="map-label start">
              A fresh start <span>●</span>
            </div>
            <div className="map-label end">
              Somewhere good <span>↗</span>
            </div>
            <div className="art-bottom">
              <Car size={28} />
              <div>
                Less planning.
                <br />
                <strong>More living.</strong>
              </div>
              <span>UBI MOVE</span>
            </div>
          </div>
        </section>
        <section id="services" className="section wrap">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ONE UBI. MORE POSSIBILITIES.</p>
              <h2>
                A little help.
                <br />A lot more day.
              </h2>
            </div>
            <p>
              From your morning commute to your evening plans, discover what UBI
              can do in your city.
            </p>
          </div>
          <div className="service-grid">
            {services.map(({ name, text, icon: Icon, color, detail }) => (
              <article className={`service ${color}`} key={name}>
                <div className="service-top">
                  <span>UBI {name.toUpperCase()}</span>
                  <Icon size={32} />
                </div>
                <h3>{text}</h3>
                <p>{detail}</p>
                <a href="#get-ubi" aria-label={`Explore UBI ${name}`}>
                  Explore {name} <ArrowUpRight size={20} />
                </a>
              </article>
            ))}
          </div>
        </section>
        <section className="section wrap">
          <div className="steps">
            <div>
              <p className="eyebrow">FROM HERE TO THERE</p>
              <h2>
                Your next move,
                <br />
                made simple.
              </h2>
            </div>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <h3>Choose what you need</h3>
                  <p>
                    Open UBI and explore the services available in your city.
                  </p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <h3>Check the details</h3>
                  <p>
                    Review your destination, price and any offer conditions.
                  </p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <h3>Confirm and get going</h3>
                  <p>Keep your booking details close, all in the app.</p>
                </div>
              </li>
            </ol>
          </div>
        </section>
        <section id="drive" className="driver-section">
          <div className="wrap driver-grid">
            <div>
              <p className="eyebrow">YOUR TIME. YOUR NEXT OPPORTUNITY.</p>
              <h2>
                Take the wheel.
                <br />
                <em>Make your move.</em>
              </h2>
              <p className="lead">
                Bring your ambition. Explore driving with UBI, review the
                requirements, and see what opportunities are available in your
                city.
              </p>
              <a className="button light" href={driver || "#driver-access"}>
                {driver
                  ? "Start your driver application"
                  : "Explore driver access"}
                <ArrowUpRight size={20} />
              </a>
            </div>
            <div className="driver-notes">
              <article>
                <Route />
                <h3>A schedule that fits</h3>
                <p>Explore driving around your availability.</p>
              </article>
              <article>
                <Wallet />
                <h3>Know the breakdown</h3>
                <p>
                  Check commission and eligible incentives before you commit.
                </p>
              </article>
              <article>
                <ShieldCheck />
                <h3>Start with the essentials</h3>
                <p>
                  Prepare your identity, licence and vehicle documents.
                  Requirements vary by market.
                </p>
              </article>
            </div>
          </div>
        </section>
        <section className="section wrap future-grid">
          <article>
            <Sparkles />
            <p className="eyebrow">MEET ASK UBI</p>
            <h2>
              Start with
              <br />a conversation.
            </h2>
            <p>
              Tell UBI what you need. Explore assistance with planning your next
              move, with a chance to review the details before confirming.
            </p>
            <span className="tag">Availability varies by market</span>
          </article>
          <article>
            <Plane />
            <p className="eyebrow">A LITTLE FURTHER AFIELD</p>
            <h2>
              Beyond your
              <br />
              everyday route.
            </h2>
            <p>
              Flights, stays and the journey in between. Discover travel options
              as they become available in UBI.
            </p>
            <span className="tag">Rolling out by market</span>
          </article>
        </section>
        <section id="questions" className="section wrap faq">
          <div>
            <p className="eyebrow">GOOD TO KNOW</p>
            <h2>
              A few things
              <br />
              before you go.
            </h2>
          </div>
          <div>
            {faqs.map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section id="get-ubi" className="download wrap">
          <Smartphone size={34} />
          <p className="eyebrow">TAKE UBI WITH YOU</p>
          <h2>
            A whole day ahead.
            <br />
            One place to start.
          </h2>
          <p>Choose your way into UBI.</p>
          <div className="access-grid">
            <article>
              <h3>For riders</h3>
              <div className="actions">
                {ios && (
                  <a className="button" href={ios}>
                    App Store ↗
                  </a>
                )}
                {android && (
                  <a className="button" href={android}>
                    Google Play ↗
                  </a>
                )}
                {rider && (
                  <a className="button" href={rider}>
                    Open UBI ↗
                  </a>
                )}
              </div>
              {!ios && !android && !rider && (
                <p>
                  Rider access links will appear here when launch availability
                  is confirmed.
                </p>
              )}
            </article>
            <article id="driver-access">
              <h3>For drivers</h3>
              {driver ? (
                <a className="button" href={driver}>
                  Apply to drive ↗
                </a>
              ) : (
                <p>
                  Driver applications will open here when onboarding is
                  available.
                </p>
              )}
            </article>
          </div>
        </section>
      </main>
      <footer className="wrap footer">
        <div>
          <a href="/" aria-label="UBI home">
            <img src="/ubi-logo-black.svg" alt="UBI" width="80" height="40" />
          </a>
          <p>Make room for more of your day.</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="#services">Explore</a>
          <a href="#drive">Drive</a>
          <a href="#questions">Questions</a>
          {privacy && <a href={privacy}>Privacy</a>}
          {terms && <a href={terms}>Terms</a>}
        </nav>
        <p className="copyright">
          © {new Date().getFullYear()} UBI. Services and offers vary by
          location.
        </p>
      </footer>
    </>
  );
}
