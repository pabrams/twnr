// generate a random integer between min and max (inclusive)
export function getRandomInt(min: number, max: number): number {
    // Ensure min is less than max
    if (isNaN(min) || isNaN(max)) {
        throw new Error("Both min and max must be numbers.");
    }
    if (min > max) {
        throw new Error("min should be less than or equal to max.");
    }

    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
