/**
 * SimpleCarto - Catalogue de polices
 * - Marianne : police officielle de l'État, licence à part (voir ./fonts/marianne.css)
 * - Les autres : Google Fonts issues d'ArduPaint (voir ./fonts/LICENSE.txt)
 */

const FONT_CATALOG = [
    { group: 'Officielle', fonts: ['Marianne'] },
    { group: 'Manuscrit',  fonts: ['Pacifico', 'Caveat', 'Sacramento', 'Great Vibes', 'Dancing Script', 'Parisienne', 'Alex Brush'] },
    { group: 'Classique',  fonts: ['Cinzel', 'Playfair Display', 'Merriweather', 'Cormorant Garamond', 'Lora'] },
    { group: 'Moderne',    fonts: ['Montserrat', 'Oswald', 'Roboto', 'Open Sans', 'Poppins', 'Bebas Neue'] },
    { group: 'Thématique', fonts: ['Lobster', 'Special Elite', 'Rye', 'Abril Fatface', 'Monoton'] }
];

const DEFAULT_FONT = 'Marianne';
