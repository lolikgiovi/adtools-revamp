/**
 * Tests for BaseTool managed listener pattern
 * Ensures memory leaks are prevented by proper cleanup
 */
import { BaseTool } from '../app/core/BaseTool.js';

// Mock EventBus
class MockEventBus {
  constructor() {
    this.handlers = {};
  }
  on(event, handler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
    return () => {
      this.handlers[event] = this.handlers[event].filter(h => h !== handler);
    };
  }
  emit(event, data) {
    if (this.handlers[event]) {
      this.handlers[event].forEach(h => h(data));
    }
  }
}

// Concrete test tool
class TestTool extends BaseTool {
  render() {
    return '<div>Test Tool</div>';
  }
}

describe('BaseTool Managed Listener Pattern', () => {
  let tool;
  let eventBus;
  let mockTarget;

  beforeEach(() => {
    eventBus = new MockEventBus();
    tool = new TestTool({ id: 'test-tool', eventBus });

    // Create a mock DOM element
    mockTarget = {
      _listeners: {},
      addEventListener(event, handler, options) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push({ handler, options });
      },
      removeEventListener(event, handler) {
        if (this._listeners[event]) {
          this._listeners[event] = this._listeners[event].filter(
            l => l.handler !== handler
          );
        }
      },
      getListenerCount(event) {
        return this._listeners[event] ? this._listeners[event].length : 0;
      }
    };
  });

  describe('addManagedListener', () => {
    it('should add event listener to target', () => {
      const handler = vi.fn();

      tool.addManagedListener(mockTarget, 'click', handler);

      expect(mockTarget.getListenerCount('click')).toBe(1);
    });

    it('should track managed listeners', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      tool.addManagedListener(mockTarget, 'click', handler1);
      tool.addManagedListener(mockTarget, 'resize', handler2);

      expect(tool._managedListeners).toHaveLength(2);
      expect(tool._managedListeners[0]).toEqual({
        target: mockTarget,
        event: 'click',
        handler: handler1,
        options: {}
      });
    });

    it('should support addEventListener options', () => {
      const handler = vi.fn();
      const options = { passive: true, capture: false };

      tool.addManagedListener(mockTarget, 'scroll', handler, options);

      expect(mockTarget._listeners['scroll'][0].options).toEqual(options);
    });
  });

  describe('removeManagedListener', () => {
    it('should remove specific managed listener', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      tool.addManagedListener(mockTarget, 'click', handler1);
      tool.addManagedListener(mockTarget, 'click', handler2);

      tool.removeManagedListener(mockTarget, 'click', handler1);

      expect(tool._managedListeners).toHaveLength(1);
      expect(tool._managedListeners[0].handler).toBe(handler2);
      expect(mockTarget.getListenerCount('click')).toBe(1);
    });

    it('should not remove other listeners', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      tool.addManagedListener(mockTarget, 'click', handler1);
      tool.addManagedListener(mockTarget, 'resize', handler2);

      tool.removeManagedListener(mockTarget, 'click', handler1);

      expect(tool._managedListeners).toHaveLength(1);
      expect(tool._managedListeners[0].event).toBe('resize');
    });
  });

  describe('removeAllManagedListeners', () => {
    it('should remove all managed listeners', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      tool.addManagedListener(mockTarget, 'click', handler1);
      tool.addManagedListener(mockTarget, 'resize', handler2);
      tool.addManagedListener(mockTarget, 'scroll', handler3);

      tool.removeAllManagedListeners();

      expect(tool._managedListeners).toHaveLength(0);
      expect(mockTarget.getListenerCount('click')).toBe(0);
      expect(mockTarget.getListenerCount('resize')).toBe(0);
      expect(mockTarget.getListenerCount('scroll')).toBe(0);
    });

    it('should handle empty listener array', () => {
      expect(() => {
        tool.removeAllManagedListeners();
      }).not.toThrow();

      expect(tool._managedListeners).toHaveLength(0);
    });
  });

  describe('deactivate (auto-cleanup)', () => {
    it('should automatically cleanup managed listeners on deactivate', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      tool.addManagedListener(mockTarget, 'click', handler1);
      tool.addManagedListener(mockTarget, 'resize', handler2);

      tool.activate(); // Set isActive = true
      tool.deactivate(); // Should cleanup

      expect(tool._managedListeners).toHaveLength(0);
      expect(mockTarget.getListenerCount('click')).toBe(0);
      expect(mockTarget.getListenerCount('resize')).toBe(0);
    });

    it('should not cleanup if already inactive (prevents duplicate cleanup)', () => {
      const handler = vi.fn();

      tool.addManagedListener(mockTarget, 'click', handler);

      tool.deactivate(); // First call (isActive is already false, so returns early)

      // Should NOT cleanup because tool was never active
      expect(tool._managedListeners).toHaveLength(1);
      expect(mockTarget.getListenerCount('click')).toBe(1);

      // Now activate and deactivate properly
      tool.activate();
      tool.deactivate();

      // Now should be cleaned up
      expect(tool._managedListeners).toHaveLength(0);
      expect(mockTarget.getListenerCount('click')).toBe(0);
    });
  });

  describe('Memory leak prevention', () => {
    it('should not accumulate listeners across multiple activate/deactivate cycles', () => {
      const handler = vi.fn();

      for (let i = 0; i < 50; i++) {
        tool.activate();
        tool.addManagedListener(mockTarget, 'resize', handler);
        tool.deactivate();
      }

      // After 50 cycles, should have 0 listeners (all cleaned up)
      expect(mockTarget.getListenerCount('resize')).toBe(0);
      expect(tool._managedListeners).toHaveLength(0);
    });

    it('should cleanup listeners added during onMount', () => {
      class ToolWithListeners extends BaseTool {
        render() {
          return '<div>Tool</div>';
        }

        onMount() {
          this._handler = vi.fn();
          this.addManagedListener(mockTarget, 'click', this._handler);
        }
      }

      const toolWithListeners = new ToolWithListeners({ id: 'test', eventBus });

      // Simulate mount
      const container = document.createElement('div');
      toolWithListeners.mount(container);
      toolWithListeners.activate();

      expect(mockTarget.getListenerCount('click')).toBe(1);

      // Simulate unmount
      toolWithListeners.deactivate();

      expect(mockTarget.getListenerCount('click')).toBe(0);
    });
  });
});
