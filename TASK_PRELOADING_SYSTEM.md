# Task Preloading and Slide Animation System

## Overview
Implements zero-latency task transitions by preloading the next task in the background and using smooth slide animations for seamless user experience.

## Implementation

### Hook: `useCards.ts`

**State Management**:
- `currentTask`: The task currently being displayed
- `nextTask`: The preloaded task ready to display
- `preloading`: Flag to prevent duplicate preload requests

**Key Functions**:

1. **`preloadNextTask()`**
   - Fetches the next task in the background
   - Runs asynchronously without blocking UI
   - Silently handles errors (doesn't disrupt user flow)

2. **`loadNextTask()`**
   - Instantly switches to preloaded task if available
   - Falls back to synchronous load if no preload
   - Triggers preload of subsequent task after transition

**Preload Triggers**:
- After initial task loads → preload task #2
- After advancing to preloaded task → preload next task
- Ensures there's always a task ready

### Screen: `QuizScreen.tsx`

**Animation System**:

1. **Slide In** (from right):
   ```
   Current Task          Next Task (preloaded)
   [  Visible  ]  -->   [Off-screen right]
   ```

2. **User answers**:
   ```
   Current Task          Next Task
   [Slide left]   <--   [Slide in from right]
   ```

3. **Result**:
   ```
   Previous Task         Current Task (was preloaded)
   [Off-screen]         [  Visible  ]
   ```

**Animation Details**:
- **Slide Out**: 250ms timing animation (left)
- **Slide In**: Spring animation (tension: 65, friction: 10)
- Uses `transform: translateX` for smooth 60fps performance
- Native driver enabled for optimal performance

**Task Identification**:
- Tracks tasks by `${targetWord}-${tier}` ID
- Prevents duplicate animations on re-renders
- Triggers animation only on genuine task changes

## User Experience

### Before (Synchronous):
```
User answers → Loading spinner (300-800ms) → New task appears
```

### After (Preloaded):
```
User answers → Instant slide transition (250ms) → New task visible
```

**Benefits**:
- ✅ Zero perceived loading time
- ✅ Smooth, native-feeling transitions
- ✅ Continuous learning flow (no interruptions)
- ✅ Professional polish

## Performance

**Network Efficiency**:
- Preload happens during user thinking time (free time)
- No additional API load (same total requests)
- Graceful degradation if preload fails

**Memory Usage**:
- Maximum 2 tasks in memory (current + next)
- Tasks are lightweight JSON objects (~1-2KB each)
- Negligible memory impact

**Animation Performance**:
- Native driver ensures 60fps
- GPU-accelerated transforms
- No JavaScript thread blocking

## Edge Cases Handled

1. **Slow Network**:
   - Falls back to synchronous load if preload incomplete
   - Shows loading indicator only if necessary
   - Transparent to user

2. **API Errors**:
   - Preload errors logged but don't disrupt flow
   - Fallback to sync load ensures continuity
   - User never sees preload failures

3. **Rapid Answering**:
   - Duplicate preload requests prevented by `preloading` flag
   - Race conditions handled gracefully
   - Tasks loaded in correct sequence

## Technical Notes

### Why Spring Animation for Entry?
- Natural, physics-based motion
- Feels responsive and lively
- Gives weight to the card

### Why Timing Animation for Exit?
- Consistent, predictable duration
- Coordinates with answer submission
- Feels purposeful and complete

### Animation Timing
- **250ms exit**: Long enough to be noticeable, short enough to feel snappy
- **100ms delay before preload**: Allows UI to settle after transition

## Future Enhancements

Possible improvements:
- Preload 2 tasks ahead during long study sessions
- Prefetch images/audio if tasks include media
- Add gesture-based swipe controls
- Implement undo/back-swipe functionality
- Cache task responses for offline mode
