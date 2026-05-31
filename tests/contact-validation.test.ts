import { describe, it, expect } from 'vitest';
import { validateContact } from '../src/lib/contact-validation';
describe('validateContact', () => {
  it('fails on empty name', () => expect(validateContact({name:'',email:'a@b.co',audience:'facility'}).ok).toBe(false));
  it('fails on bad email', () => expect(validateContact({name:'A',email:'nope',audience:'facility'}).ok).toBe(false));
  it('fails on missing audience', () => expect(validateContact({name:'A',email:'a@b.co',audience:''}).ok).toBe(false));
  it('passes when all valid', () => expect(validateContact({name:'A',email:'a@b.co',audience:'clinician'}).ok).toBe(true));
});
