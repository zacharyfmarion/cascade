import { describe, it, expect, beforeEach } from 'vitest';
import { HandleMap } from '../handleMap';

describe('HandleMap', () => {
  let handleMap: HandleMap;

  beforeEach(() => {
    handleMap = new HandleMap();
  });

  describe('getOrCreate', () => {
    it('should create a handle with prefix and suffix for a new nodeId', () => {
      const handle = handleMap.getOrCreate('node1', 'gaussian_blur');
      expect(handle).toBe('blur1');
      expect(handleMap.getHandle('node1')).toBe('blur1');
      expect(handleMap.getNodeId('blur1')).toBe('node1');
    });

    it('should return the same handle on subsequent calls (idempotent)', () => {
      const handle1 = handleMap.getOrCreate('node1', 'gaussian_blur');
      const handle2 = handleMap.getOrCreate('node1', 'gaussian_blur');
      expect(handle1).toBe(handle2);
      expect(handle2).toBe('blur1');
    });

    it('should create different handles for different nodeIds with the same typeId', () => {
      const handle1 = handleMap.getOrCreate('node1', 'gaussian_blur');
      const handle2 = handleMap.getOrCreate('node2', 'gaussian_blur');
      expect(handle1).toBe('blur1');
      expect(handle2).toBe('blur2');
      expect(handleMap.getHandle('node1')).toBe('blur1');
      expect(handleMap.getHandle('node2')).toBe('blur2');
    });

    it('should use aliases from HANDLE_ALIASES table', () => {
      const blurHandle = handleMap.getOrCreate('node1', 'gaussian_blur');
      expect(blurHandle).toMatch(/^blur\d+$/);
      
      const gradeHandle = handleMap.getOrCreate('node2', 'gpu_kernel::brightness_contrast');
      expect(gradeHandle).toMatch(/^grade\d+$/);
      
      const viewerHandle = handleMap.getOrCreate('node3', 'viewer');
      expect(viewerHandle).toMatch(/^viewer\d+$/);
    });

    it('should use first word of typeId for unknown types', () => {
      const handle = handleMap.getOrCreate('node1', 'my_custom_node');
      expect(handle).toBe('my1');
    });

    it('should increment suffix for multiple aliases of same type', () => {
      const blur1 = handleMap.getOrCreate('id1', 'gaussian_blur');
      const blur2 = handleMap.getOrCreate('id2', 'gaussian_blur');
      const blur3 = handleMap.getOrCreate('id3', 'gaussian_blur');
      expect(blur1).toBe('blur1');
      expect(blur2).toBe('blur2');
      expect(blur3).toBe('blur3');
    });
  });

  describe('set', () => {
    it('should set a handle for a nodeId and be retrievable', () => {
      handleMap.set('myblur', 'node1');
      expect(handleMap.getHandle('node1')).toBe('myblur');
      expect(handleMap.getNodeId('myblur')).toBe('node1');
    });

    it('should throw Error for invalid handle (uppercase)', () => {
      expect(() => handleMap.set('MyBlur', 'node1')).toThrow('Invalid handle: MyBlur');
    });

    it('should throw Error for invalid handle (starting with number)', () => {
      expect(() => handleMap.set('1blur', 'node1')).toThrow('Invalid handle: 1blur');
    });

    it('should throw Error for invalid handle (special characters)', () => {
      expect(() => handleMap.set('my-blur', 'node1')).toThrow('Invalid handle: my-blur');
    });

    it('should remove old mapping when setting handle already used by another nodeId', () => {
      handleMap.set('blur1', 'node1');
      handleMap.set('blur1', 'node2');
      
      expect(handleMap.getHandle('node1')).toBeUndefined();
      expect(handleMap.getHandle('node2')).toBe('blur1');
      expect(handleMap.getNodeId('blur1')).toBe('node2');
    });

    it('should remove old handle when setting nodeId that already has a different handle', () => {
      handleMap.set('blur1', 'node1');
      handleMap.set('blur2', 'node1');
      
      expect(handleMap.getHandle('node1')).toBe('blur2');
      expect(handleMap.getNodeId('blur1')).toBeUndefined();
      expect(handleMap.getNodeId('blur2')).toBe('node1');
    });

    it('should track suffix when manually setting handle with number', () => {
      handleMap.set('blur5', 'node1');
      const nextHandle = handleMap.getOrCreate('node2', 'gaussian_blur');
      expect(nextHandle).toBe('blur6');
    });

    it('should accept valid lowercase handle with underscores and numbers', () => {
      handleMap.set('my_blur_1', 'node1');
      expect(handleMap.getHandle('node1')).toBe('my_blur_1');
    });
  });

  describe('removeByNodeId', () => {
    it('should remove both directions of mapping', () => {
      handleMap.set('blur1', 'node1');
      handleMap.removeByNodeId('node1');
      
      expect(handleMap.getHandle('node1')).toBeUndefined();
      expect(handleMap.getNodeId('blur1')).toBeUndefined();
      expect(handleMap.hasNodeId('node1')).toBe(false);
      expect(handleMap.hasHandle('blur1')).toBe(false);
    });

    it('should not error when removing non-existent nodeId', () => {
      expect(() => handleMap.removeByNodeId('non_existent')).not.toThrow();
    });
  });

  describe('removeByHandle', () => {
    it('should remove both directions of mapping', () => {
      handleMap.set('blur1', 'node1');
      handleMap.removeByHandle('blur1');
      
      expect(handleMap.getHandle('node1')).toBeUndefined();
      expect(handleMap.getNodeId('blur1')).toBeUndefined();
      expect(handleMap.hasNodeId('node1')).toBe(false);
      expect(handleMap.hasHandle('blur1')).toBe(false);
    });

    it('should not error when removing non-existent handle', () => {
      expect(() => handleMap.removeByHandle('non_existent')).not.toThrow();
    });
  });

  describe('hasHandle', () => {
    it('should return true for existing handle', () => {
      handleMap.set('blur1', 'node1');
      expect(handleMap.hasHandle('blur1')).toBe(true);
    });

    it('should return false for non-existing handle', () => {
      expect(handleMap.hasHandle('blur1')).toBe(false);
    });
  });

  describe('hasNodeId', () => {
    it('should return true for existing nodeId', () => {
      handleMap.set('blur1', 'node1');
      expect(handleMap.hasNodeId('node1')).toBe(true);
    });

    it('should return false for non-existing nodeId', () => {
      expect(handleMap.hasNodeId('node1')).toBe(false);
    });
  });

  describe('entries', () => {
    it('should return empty array for empty map', () => {
      expect(handleMap.entries()).toEqual([]);
    });

    it('should return all [handle, nodeId] pairs', () => {
      handleMap.set('blur1', 'node1');
      handleMap.set('grade1', 'node2');
      handleMap.set('viewer1', 'node3');
      
      const entries = handleMap.entries();
      expect(entries).toHaveLength(3);
      expect(entries).toContainEqual(['blur1', 'node1']);
      expect(entries).toContainEqual(['grade1', 'node2']);
      expect(entries).toContainEqual(['viewer1', 'node3']);
    });

    it('should return current entries after removals', () => {
      handleMap.set('blur1', 'node1');
      handleMap.set('grade1', 'node2');
      handleMap.removeByNodeId('node1');
      
      const entries = handleMap.entries();
      expect(entries).toHaveLength(1);
      expect(entries).toEqual([['grade1', 'node2']]);
    });
  });

  describe('clear', () => {
    it('should clear all mappings', () => {
      handleMap.set('blur1', 'node1');
      handleMap.set('grade1', 'node2');
      handleMap.clear();
      
      expect(handleMap.entries()).toEqual([]);
      expect(handleMap.hasHandle('blur1')).toBe(false);
      expect(handleMap.hasNodeId('node1')).toBe(false);
    });

    it('should reset suffix tracking after clear', () => {
      handleMap.set('blur5', 'node1');
      handleMap.clear();
      
      // After clear, the next getOrCreate should start fresh
      const newHandle = handleMap.getOrCreate('node2', 'gaussian_blur');
      expect(newHandle).toBe('blur1');
    });
  });

  describe('suffix tracking', () => {
    it('should not reuse removed handles - counter does not go backward', () => {
      const blur1 = handleMap.getOrCreate('id1', 'gaussian_blur');
      expect(blur1).toBe('blur1');
      
      handleMap.removeByNodeId('id1');
      
      const blur2 = handleMap.getOrCreate('id2', 'gaussian_blur');
      expect(blur2).toBe('blur2');
    });

    it('should increment suffix correctly across multiple types', () => {
      const blur1 = handleMap.getOrCreate('id1', 'gaussian_blur');
      const grade1 = handleMap.getOrCreate('id2', 'gpu_kernel::brightness_contrast');
      const blur2 = handleMap.getOrCreate('id3', 'gaussian_blur');
      const grade2 = handleMap.getOrCreate('id4', 'gpu_kernel::brightness_contrast');
      
      expect(blur1).toBe('blur1');
      expect(grade1).toBe('grade1');
      expect(blur2).toBe('blur2');
      expect(grade2).toBe('grade2');
    });
  });

  describe('getHandle and getNodeId', () => {
    it('should return undefined for non-existent nodeId', () => {
      expect(handleMap.getHandle('non_existent')).toBeUndefined();
    });

    it('should return undefined for non-existent handle', () => {
      expect(handleMap.getNodeId('non_existent')).toBeUndefined();
    });

    it('should return correct values after set', () => {
      handleMap.set('custom_blur', 'my_node');
      expect(handleMap.getHandle('my_node')).toBe('custom_blur');
      expect(handleMap.getNodeId('custom_blur')).toBe('my_node');
    });
  });

  describe('complex scenarios', () => {
    it('should handle multiple operations in sequence', () => {
      // Create initial mappings
      const blur1 = handleMap.getOrCreate('id1', 'gaussian_blur');
      const grade1 = handleMap.getOrCreate('id2', 'gpu_kernel::brightness_contrast');
      
      expect(blur1).toBe('blur1');
      expect(grade1).toBe('grade1');
      
      // Reassign blur1 to a new nodeId
      handleMap.set('blur1', 'id3');
      expect(handleMap.getNodeId('blur1')).toBe('id3');
      expect(handleMap.getHandle('id1')).toBeUndefined();
      
      // Create new blur for old id1
      const blur2 = handleMap.getOrCreate('id1', 'gaussian_blur');
      expect(blur2).toBe('blur2');
      
      // Check final state
      expect(handleMap.entries()).toHaveLength(3);
      expect(handleMap.hasHandle('blur1')).toBe(true);
      expect(handleMap.hasHandle('blur2')).toBe(true);
      expect(handleMap.hasHandle('grade1')).toBe(true);
    });

    it('should maintain consistency across all methods', () => {
      handleMap.set('blur1', 'node1');
      handleMap.set('grade1', 'node2');
      handleMap.set('viewer1', 'node3');
      
      // Verify forward and backward lookups match
      const entries = handleMap.entries();
      for (const [handle, nodeId] of entries) {
        expect(handleMap.getHandle(nodeId)).toBe(handle);
        expect(handleMap.getNodeId(handle)).toBe(nodeId);
        expect(handleMap.hasHandle(handle)).toBe(true);
        expect(handleMap.hasNodeId(nodeId)).toBe(true);
      }
      
      // Verify no orphaned entries
      expect(entries.length).toBe(3);
    });
  });
});
