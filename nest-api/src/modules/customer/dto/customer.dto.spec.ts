import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateCustomerDto,
  ListCustomerFilterDto,
  RevokeLicenseDto,
  UpdateCustomerDto,
} from './customer.dto';

async function expectValidationErrors(instance: object) {
  const errors = await validate(instance);
  return errors.map((e) => ({ property: e.property, constraints: e.constraints }));
}

describe('CreateCustomerDto', () => {
  it('合法输入通过', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      name: '张三公司',
      contact: '13800000000',
      remark: 'VIP 客户',
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('name 过短被拒', async () => {
    const dto = plainToInstance(CreateCustomerDto, { name: 'A' });
    const errs = await expectValidationErrors(dto);
    expect(errs.find((e) => e.property === 'name')).toBeDefined();
  });

  it('name 超长被拒', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      name: 'x'.repeat(121),
    });
    const errs = await expectValidationErrors(dto);
    expect(errs.find((e) => e.property === 'name')).toBeDefined();
  });

  it('name 缺失被拒', async () => {
    const dto = plainToInstance(CreateCustomerDto, {});
    const errs = await expectValidationErrors(dto);
    expect(errs.find((e) => e.property === 'name')).toBeDefined();
  });

  it('contact 超长被拒', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      name: '正常名',
      contact: 'x'.repeat(256),
    });
    const errs = await expectValidationErrors(dto);
    expect(errs.find((e) => e.property === 'contact')).toBeDefined();
  });

  it('contact / remark 均可选', async () => {
    const dto = plainToInstance(CreateCustomerDto, { name: '正常名' });
    expect(await validate(dto)).toEqual([]);
  });

  it('loginUserName / loginPassword 均合法时通过', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      name: '正常名',
      loginUserName: 'alice',
      loginPassword: 'secret123',
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('loginUserName 过短被拒（<3）', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      name: '正常名',
      loginUserName: 'ab',
      loginPassword: 'secret123',
    });
    const errs = await expectValidationErrors(dto);
    expect(errs.find((e) => e.property === 'loginUserName')).toBeDefined();
  });

  it('loginPassword 过短被拒（<6）', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      name: '正常名',
      loginUserName: 'alice',
      loginPassword: '123',
    });
    const errs = await expectValidationErrors(dto);
    expect(errs.find((e) => e.property === 'loginPassword')).toBeDefined();
  });
});

describe('UpdateCustomerDto', () => {
  it('合法输入通过', async () => {
    const dto = plainToInstance(UpdateCustomerDto, {
      id: 1,
      name: '新名字',
      status: 'active',
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('id 必填', async () => {
    const dto = plainToInstance(UpdateCustomerDto, { name: '新名' });
    const errs = await expectValidationErrors(dto);
    expect(errs.find((e) => e.property === 'id')).toBeDefined();
  });

  it('status 必须在 active/suspended 内', async () => {
    const dto = plainToInstance(UpdateCustomerDto, {
      id: 1,
      status: 'hacking',
    });
    const errs = await expectValidationErrors(dto);
    expect(errs.find((e) => e.property === 'status')).toBeDefined();
  });
});

describe('ListCustomerFilterDto', () => {
  it('空参数通过', async () => {
    const dto = plainToInstance(ListCustomerFilterDto, {});
    expect(await validate(dto)).toEqual([]);
  });

  it('status=all 通过', async () => {
    const dto = plainToInstance(ListCustomerFilterDto, { status: 'all' });
    expect(await validate(dto)).toEqual([]);
  });

  it('非法 status 被拒', async () => {
    const dto = plainToInstance(ListCustomerFilterDto, { status: 'xxx' });
    const errs = await expectValidationErrors(dto);
    expect(errs.find((e) => e.property === 'status')).toBeDefined();
  });
});

describe('RevokeLicenseDto', () => {
  it('合法输入通过', async () => {
    const dto = plainToInstance(RevokeLicenseDto, { customerId: 1, reason: 'x' });
    expect(await validate(dto)).toEqual([]);
  });

  it('customerId 必填且为整数', async () => {
    const dto = plainToInstance(RevokeLicenseDto, {});
    const errs = await expectValidationErrors(dto);
    expect(errs.find((e) => e.property === 'customerId')).toBeDefined();
  });

  it('reason 可选', async () => {
    const dto = plainToInstance(RevokeLicenseDto, { customerId: 1 });
    expect(await validate(dto)).toEqual([]);
  });
});
