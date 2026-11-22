export class ComponentHealth {
  constructor(components) {
    this.components = components;
    this.health = Object.fromEntries(Object.keys(components).map((key) => [key, 1]));
  }

  reset() {
    for (const key of Object.keys(this.components)) this.health[key] = 1;
  }

  condition(key) {
    return this.health[key] ?? 1;
  }

  wear(key, amount) {
    const component = this.components[key];
    if (!component) return 0;
    const available = this.health[key] * component.capacity;
    this.health[key] = Math.max(0, available - amount) / component.capacity;
    return Math.max(0, amount - available);
  }
}
