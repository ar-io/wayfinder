# Wayfinder Coding Guidelines

## Function Arguments

Always prefer object parameters over positional arguments for functions, especially when:
- The function has more than 2 parameters
- The function might need additional parameters in the future
- The parameters are optional
- The function is part of the public API

### ✅ Good - Object Parameters

```typescript
type CreateFunctionParams = {
  name: string;
  logger?: Logger;
  timeout?: number;
  retries?: number;
};

function createFunction({
  name,
  logger,
  timeout = 5000,
  retries = 3,
}: CreateFunctionParams): void {
  // implementation
}

// Usage is clear and self-documenting
createFunction({
  name: 'myFunction',
  timeout: 10000,
  logger: customLogger,
});
```

### ❌ Bad - Positional Arguments

```typescript
function createFunction(
  name: string,
  logger?: Logger,
  timeout?: number,
  retries?: number,
): void {
  // implementation
}

// Usage is unclear without looking at the function signature
createFunction('myFunction', undefined, 10000, 3);
```

## Benefits

1. **Self-documenting**: Parameter names are visible at the call site
2. **Order-independent**: Can specify parameters in any order
3. **Future-proof**: Easy to add new optional parameters without breaking existing calls
4. **Partial application**: Easy to create wrapper functions with preset values
5. **Better IDE support**: Auto-completion shows parameter names

## Exceptions

Positional arguments are acceptable for:
- Functions with a single parameter
- Simple utility functions with 2 parameters where the order is obvious (e.g., `add(a, b)`)
- Array methods and other standard library patterns

## TypeScript Tips

- Define a type for the parameters object to ensure type safety
- Use destructuring with default values in the function signature
- Consider making the entire params object optional if all properties are optional