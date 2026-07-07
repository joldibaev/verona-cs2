const levelColors = ['#ffffff', '#1ce400', '#1ce400', '#ffc800', '#ffc800', '#ffc800', '#ffc800', '#ff681c', '#ff681c', '#ff2e17'];
const levelProgress = ['8%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', '100%'];
export function faceitLevel(elo) {
    return elo >= 2001 ? 10 : elo >= 1751 ? 9 : elo >= 1531 ? 8 : elo >= 1351 ? 7 : elo >= 1201 ? 6 : elo >= 1051 ? 5 : elo >= 901 ? 4 : elo >= 751 ? 3 : elo >= 501 ? 2 : 1;
}
// CSS custom properties let one markup shape reproduce FACEIT's per-level
// color and progress arc without shipping or hotlinking third-party icons.
export function faceitBadgeStyle(elo) {
    const index = faceitLevel(elo) - 1;
    return { '--level-color': levelColors[index], '--level-progress': levelProgress[index] };
}
