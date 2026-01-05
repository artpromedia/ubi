import React, { useState } from 'react';

const UbiBouncyLogoAssets = () => {
  const [darkMode, setDarkMode] = useState(false);
  
  const colors = {
    ubiBlack: '#191414',
    ubiGreen: '#1DB954',
    ubiWhite: '#FFFFFF',
    ubiGray: '#666666',
    ubiLightGray: '#E5E5E5',
  };

  // Main Bouncy Logo Component
  const UbiLogo = ({ size = 60, color = colors.ubiBlack, dotColor = colors.ubiGreen }) => (
    <svg width={size * 2} height={size} viewBox="0 0 120 60" fill="none">
      {/* U - sitting lower */}
      <path 
        d="M8 18 L8 42 Q8 54 20 54 Q32 54 32 42 L32 18"
        stroke={color}
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
      />
      {/* b - bounced up */}
      <path 
        d="M46 4 L46 44 M46 26 Q46 18 56 18 Q68 18 68 31 Q68 44 56 44 Q46 44 46 36"
        stroke={color}
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* i - bounced down */}
      <line x1="84" y1="24" x2="84" y2="52" stroke={color} strokeWidth="9" strokeLinecap="round"/>
      {/* Green dot */}
      <circle cx="84" cy="12" r="6" fill={dotColor}/>
    </svg>
  );

  // Compact Icon (for app icon - just stylized "U" from the logo)
  const UbiIcon = ({ size = 60, color = colors.ubiWhite, dotColor = colors.ubiGreen }) => (
    <svg width={size} height={size} viewBox="0 0 60 60" fill="none">
      {/* Stylized U with bounce */}
      <path 
        d="M15 12 L15 38 Q15 52 30 52 Q45 52 45 38 L45 12"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        fill="none"
      />
      {/* Green dot accent */}
      <circle cx="45" cy="8" r="6" fill={dotColor}/>
    </svg>
  );

  // Service Logos
  const UbiMove = ({ size = 40, color = colors.ubiBlack }) => (
    <div className="flex items-center gap-2">
      <UbiLogo size={size} color={color} />
      <span style={{ 
        fontSize: size * 0.6, 
        fontWeight: 600, 
        color: color,
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>Move</span>
    </div>
  );

  const UbiBites = ({ size = 40, color = colors.ubiBlack }) => (
    <div className="flex items-center gap-2">
      <UbiLogo size={size} color={color} />
      <span style={{ 
        fontSize: size * 0.6, 
        fontWeight: 600, 
        color: color,
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>Bites</span>
    </div>
  );

  const UbiSend = ({ size = 40, color = colors.ubiBlack }) => (
    <div className="flex items-center gap-2">
      <UbiLogo size={size} color={color} />
      <span style={{ 
        fontSize: size * 0.6, 
        fontWeight: 600, 
        color: color,
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>Send</span>
    </div>
  );

  const UbiCeerion = ({ size = 40, color = colors.ubiBlack }) => (
    <div className="flex items-center gap-2">
      <UbiLogo size={size} color={color} dotColor={colors.ubiGreen} />
      <span style={{ 
        fontSize: size * 0.5, 
        fontWeight: 600, 
        color: color,
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>+ CEERION</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Ubi Logo Assets</h1>
          <p className="text-gray-600">Bouncy wordmark — Complete brand asset kit</p>
        </div>

        {/* Primary Logo */}
        <section className="bg-white rounded-2xl p-8 mb-8 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-500 mb-6 uppercase tracking-wide">Primary Logo</h2>
          <div className="flex items-center justify-center py-12">
            <UbiLogo size={80} />
          </div>
          <div className="grid grid-cols-3 gap-4 mt-8 text-center text-xs text-gray-500">
            <div>
              <p className="font-medium text-gray-700 mb-1">Full Color</p>
              <p>Black wordmark + Green dot</p>
            </div>
            <div>
              <p className="font-medium text-gray-700 mb-1">Usage</p>
              <p>Primary brand applications</p>
            </div>
            <div>
              <p className="font-medium text-gray-700 mb-1">Clear Space</p>
              <p>Height of "i" dot on all sides</p>
            </div>
          </div>
        </section>

        {/* Color Variations */}
        <section className="bg-white rounded-2xl p-8 mb-8 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-500 mb-6 uppercase tracking-wide">Color Variations</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Black on White */}
            <div className="text-center">
              <div className="bg-white border border-gray-200 rounded-xl p-6 flex items-center justify-center h-32">
                <UbiLogo size={45} color={colors.ubiBlack} />
              </div>
              <p className="text-xs text-gray-500 mt-2">Black on White</p>
              <p className="text-xs text-gray-400">Primary</p>
            </div>
            {/* White on Black */}
            <div className="text-center">
              <div className="rounded-xl p-6 flex items-center justify-center h-32" style={{ backgroundColor: colors.ubiBlack }}>
                <UbiLogo size={45} color={colors.ubiWhite} />
              </div>
              <p className="text-xs text-gray-500 mt-2">White on Black</p>
              <p className="text-xs text-gray-400">Dark backgrounds</p>
            </div>
            {/* White on Green */}
            <div className="text-center">
              <div className="rounded-xl p-6 flex items-center justify-center h-32" style={{ backgroundColor: colors.ubiGreen }}>
                <UbiLogo size={45} color={colors.ubiWhite} dotColor={colors.ubiWhite} />
              </div>
              <p className="text-xs text-gray-500 mt-2">White on Green</p>
              <p className="text-xs text-gray-400">Brand moments</p>
            </div>
            {/* Green on Black */}
            <div className="text-center">
              <div className="rounded-xl p-6 flex items-center justify-center h-32" style={{ backgroundColor: colors.ubiBlack }}>
                <UbiLogo size={45} color={colors.ubiGreen} dotColor={colors.ubiGreen} />
              </div>
              <p className="text-xs text-gray-500 mt-2">Green on Black</p>
              <p className="text-xs text-gray-400">Special use</p>
            </div>
          </div>
        </section>

        {/* App Icons */}
        <section className="bg-white rounded-2xl p-8 mb-8 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-500 mb-6 uppercase tracking-wide">App Icons</h2>
          
          {/* Main App Icon Options */}
          <div className="mb-8">
            <p className="text-xs text-gray-400 mb-4">Primary App Icon</p>
            <div className="flex gap-6 items-end flex-wrap">
              {/* Option 1: Full wordmark in black square */}
              <div className="text-center">
                <div 
                  className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg"
                  style={{ backgroundColor: colors.ubiBlack }}
                >
                  <UbiLogo size={32} color={colors.ubiWhite} />
                </div>
                <p className="text-xs text-gray-500 mt-2">Wordmark</p>
                <p className="text-xs text-green-600">Recommended</p>
              </div>
              {/* Option 2: Icon only */}
              <div className="text-center">
                <div 
                  className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg"
                  style={{ backgroundColor: colors.ubiBlack }}
                >
                  <UbiIcon size={48} color={colors.ubiWhite} />
                </div>
                <p className="text-xs text-gray-500 mt-2">Icon Only</p>
                <p className="text-xs text-gray-400">Alternative</p>
              </div>
              {/* Option 3: Green background */}
              <div className="text-center">
                <div 
                  className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg"
                  style={{ backgroundColor: colors.ubiGreen }}
                >
                  <UbiLogo size={32} color={colors.ubiBlack} dotColor={colors.ubiBlack} />
                </div>
                <p className="text-xs text-gray-500 mt-2">Green BG</p>
                <p className="text-xs text-gray-400">Alternative</p>
              </div>
            </div>
          </div>

          {/* Size Scale */}
          <div className="mb-8">
            <p className="text-xs text-gray-400 mb-4">Size Scale</p>
            <div className="flex gap-4 items-end flex-wrap">
              {[
                { size: 80, label: '512px', desc: 'App Store' },
                { size: 64, label: '180px', desc: 'iOS' },
                { size: 48, label: '144px', desc: 'Android' },
                { size: 40, label: '120px', desc: 'Spotlight' },
                { size: 32, label: '80px', desc: 'Settings' },
                { size: 24, label: '60px', desc: 'Notification' },
                { size: 16, label: '32px', desc: 'Favicon' },
              ].map(({ size, label, desc }) => (
                <div key={label} className="text-center">
                  <div 
                    className="rounded-xl flex items-center justify-center shadow-md mx-auto"
                    style={{ 
                      width: size, 
                      height: size, 
                      backgroundColor: colors.ubiBlack,
                      borderRadius: size * 0.22
                    }}
                  >
                    <UbiLogo size={size * 0.4} color={colors.ubiWhite} />
                  </div>
                  <p className="text-xs text-gray-500 mt-2">{label}</p>
                  <p className="text-xs text-gray-400">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Service Logos */}
        <section className="bg-white rounded-2xl p-8 mb-8 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-500 mb-6 uppercase tracking-wide">Service Logos</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="bg-gray-50 rounded-xl p-6 flex items-center justify-center h-24">
                <UbiMove size={35} />
              </div>
              <p className="text-xs text-gray-500 mt-2">Ubi Move</p>
              <p className="text-xs text-gray-400">Ride-hailing</p>
            </div>
            <div className="text-center">
              <div className="bg-gray-50 rounded-xl p-6 flex items-center justify-center h-24">
                <UbiBites size={35} />
              </div>
              <p className="text-xs text-gray-500 mt-2">Ubi Bites</p>
              <p className="text-xs text-gray-400">Food delivery</p>
            </div>
            <div className="text-center">
              <div className="bg-gray-50 rounded-xl p-6 flex items-center justify-center h-24">
                <UbiSend size={35} />
              </div>
              <p className="text-xs text-gray-500 mt-2">Ubi Send</p>
              <p className="text-xs text-gray-400">Package delivery</p>
            </div>
            <div className="text-center">
              <div className="bg-gray-50 rounded-xl p-6 flex items-center justify-center h-24">
                <UbiCeerion size={35} />
              </div>
              <p className="text-xs text-gray-500 mt-2">Ubi + CEERION</p>
              <p className="text-xs text-gray-400">EV financing</p>
            </div>
          </div>

          {/* Dark versions */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-6">
            <div className="rounded-xl p-6 flex items-center justify-center h-24" style={{ backgroundColor: colors.ubiBlack }}>
              <UbiMove size={35} color={colors.ubiWhite} />
            </div>
            <div className="rounded-xl p-6 flex items-center justify-center h-24" style={{ backgroundColor: colors.ubiBlack }}>
              <UbiBites size={35} color={colors.ubiWhite} />
            </div>
            <div className="rounded-xl p-6 flex items-center justify-center h-24" style={{ backgroundColor: colors.ubiBlack }}>
              <UbiSend size={35} color={colors.ubiWhite} />
            </div>
            <div className="rounded-xl p-6 flex items-center justify-center h-24" style={{ backgroundColor: colors.ubiBlack }}>
              <UbiCeerion size={35} color={colors.ubiWhite} />
            </div>
          </div>
        </section>

        {/* Brand Colors */}
        <section className="bg-white rounded-2xl p-8 mb-8 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-500 mb-6 uppercase tracking-wide">Brand Colors</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { name: 'Ubi Black', hex: '#191414', rgb: '25, 20, 20', usage: 'Primary text, backgrounds' },
              { name: 'Ubi Green', hex: '#1DB954', rgb: '29, 185, 84', usage: 'Accent, CTAs, dot' },
              { name: 'Ubi White', hex: '#FFFFFF', rgb: '255, 255, 255', usage: 'Backgrounds, reversed' },
              { name: 'Ubi Gray', hex: '#666666', rgb: '102, 102, 102', usage: 'Secondary text' },
              { name: 'Ubi Light', hex: '#E5E5E5', rgb: '229, 229, 229', usage: 'Borders, dividers' },
            ].map((color) => (
              <div key={color.name}>
                <div 
                  className="h-24 rounded-xl mb-3 shadow-inner"
                  style={{ 
                    backgroundColor: color.hex,
                    border: color.hex === '#FFFFFF' ? '1px solid #E5E5E5' : 'none'
                  }}
                />
                <p className="font-medium text-sm text-gray-900">{color.name}</p>
                <p className="text-xs text-gray-500">{color.hex}</p>
                <p className="text-xs text-gray-400">RGB: {color.rgb}</p>
                <p className="text-xs text-gray-400 mt-1">{color.usage}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Typography */}
        <section className="bg-white rounded-2xl p-8 mb-8 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-500 mb-6 uppercase tracking-wide">Typography Pairing</h2>
          <div className="space-y-6">
            <div>
              <p className="text-xs text-gray-400 mb-2">Headlines — Poppins Bold</p>
              <p style={{ fontFamily: 'Poppins, system-ui, sans-serif', fontWeight: 700, fontSize: 32 }}>
                Go anywhere with Ubi
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-2">Subheadlines — Poppins SemiBold</p>
              <p style={{ fontFamily: 'Poppins, system-ui, sans-serif', fontWeight: 600, fontSize: 20 }}>
                Rides, food, packages — all in one app
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-2">Body — Inter Regular</p>
              <p style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400, fontSize: 16, color: '#666' }}>
                Ubi connects you to reliable rides, delicious food, and fast deliveries across Africa. 
                Join millions who trust Ubi for their daily journeys.
              </p>
            </div>
          </div>
        </section>

        {/* Clear Space & Minimum Size */}
        <section className="bg-white rounded-2xl p-8 mb-8 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-500 mb-6 uppercase tracking-wide">Clear Space & Minimum Size</h2>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-xs text-gray-400 mb-4">Clear Space (use height of green dot)</p>
              <div className="bg-gray-100 rounded-xl p-8 flex items-center justify-center relative">
                <div className="border-2 border-dashed border-green-400 p-6 rounded">
                  <UbiLogo size={50} />
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-4">Minimum Size</p>
              <div className="bg-gray-100 rounded-xl p-8">
                <div className="flex items-end gap-6">
                  <div className="text-center">
                    <UbiLogo size={24} />
                    <p className="text-xs text-gray-500 mt-2">48px wide</p>
                    <p className="text-xs text-green-600">Minimum print</p>
                  </div>
                  <div className="text-center">
                    <UbiLogo size={16} />
                    <p className="text-xs text-gray-500 mt-2">32px wide</p>
                    <p className="text-xs text-green-600">Minimum digital</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Don'ts */}
        <section className="bg-white rounded-2xl p-8 mb-8 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-500 mb-6 uppercase tracking-wide">Logo Don'ts</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="bg-gray-100 rounded-xl p-6 flex items-center justify-center h-28 relative">
                <div style={{ transform: 'rotate(15deg)' }}>
                  <UbiLogo size={35} />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-red-500 text-4xl">✕</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">Don't rotate</p>
            </div>
            <div className="text-center">
              <div className="bg-gray-100 rounded-xl p-6 flex items-center justify-center h-28 relative">
                <div style={{ transform: 'scaleX(1.5)' }}>
                  <UbiLogo size={30} />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-red-500 text-4xl">✕</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">Don't stretch</p>
            </div>
            <div className="text-center">
              <div className="bg-gray-100 rounded-xl p-6 flex items-center justify-center h-28 relative">
                <UbiLogo size={35} color="#FF6B6B" dotColor="#FF6B6B" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-red-500 text-4xl">✕</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">Don't recolor</p>
            </div>
            <div className="text-center">
              <div className="bg-gray-100 rounded-xl p-6 flex items-center justify-center h-28 relative" style={{ opacity: 0.3 }}>
                <UbiLogo size={35} />
              </div>
              <div className="absolute inset-0 flex items-center justify-center" style={{ marginTop: -80 }}>
                <span className="text-red-500 text-4xl">✕</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">Don't use low contrast</p>
            </div>
          </div>
        </section>

        {/* Usage Examples */}
        <section className="bg-white rounded-2xl p-8 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-500 mb-6 uppercase tracking-wide">Usage Examples</h2>
          
          {/* App Header Mock */}
          <div className="mb-8">
            <p className="text-xs text-gray-400 mb-4">App Header</p>
            <div className="rounded-xl overflow-hidden shadow-lg" style={{ maxWidth: 375 }}>
              <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: colors.ubiBlack }}>
                <UbiLogo size={24} color={colors.ubiWhite} />
                <div className="flex gap-4">
                  <span style={{ color: colors.ubiWhite }}>🔔</span>
                  <span style={{ color: colors.ubiWhite }}>👤</span>
                </div>
              </div>
              <div className="p-4 bg-gray-50">
                <div className="bg-white rounded-xl p-4 shadow-sm">
                  <p className="text-gray-500 text-sm">Where are you going?</p>
                </div>
              </div>
            </div>
          </div>

          {/* Splash Screen Mock */}
          <div>
            <p className="text-xs text-gray-400 mb-4">Splash Screen</p>
            <div 
              className="rounded-xl overflow-hidden shadow-lg flex items-center justify-center"
              style={{ maxWidth: 375, height: 300, backgroundColor: colors.ubiBlack }}
            >
              <div className="text-center">
                <UbiLogo size={60} color={colors.ubiWhite} />
                <p className="mt-4 text-sm" style={{ color: colors.ubiGreen }}>Go anywhere</p>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
};

export default UbiBouncyLogoAssets;
