import test from "node:test";
import assert from "node:assert/strict";
import { parseRoster, parseScores } from "../lib/import-validation.ts";

const students=[{student_no:"0012",full_name:"张三"},{student_no:"A003",full_name:"李四"}];
test("可选密码表头与前导零", () => {
  assert.deepEqual(parseRoster({headers:["学号（必填）","姓名","密码（可选）"],rows:[["0012"," 张三 ","Pass123456"],["a003","李四",""]]}),[
    {student_no:"0012",full_name:"张三",initial_password:"Pass123456"},{student_no:"A003",full_name:"李四",initial_password:""}
  ]);
});
test("缺失姓名、重复学号、密码长度均报错", () => {
  for (const rows of [[["12",""]],[["12","甲"],["12","乙"]],[["12","甲","123"]]]) {
    assert.throws(()=>parseRoster({headers:["学号","姓名","密码"],rows}));
  }
});
test("密码保留真实空格，空白密码视为未设置",()=>{
  const rows=parseRoster({headers:["学号","姓名","密码"],rows:[["1","甲"," longpass10 "],["2","乙","   "]]});
  assert.equal(rows[0].initial_password," longpass10 ");assert.equal(rows[1].initial_password,"");
});
test("多项目成绩、零分、小数与空白", () => {
  const rows=parseScores({headers:["学号","姓名","期中","期末"],rows:[["0012","张三","0","88.25"],["A003","李四","","92"]]},students);
  assert.deepEqual(rows.map(r=>r.score),[0,88.25,92]);
  assert.equal(rows[1].assessment_name,"期末");
});
test("成绩必须匹配学号和姓名", () => {
  for (const row of [["0012","李四","80"],["999","张三","80"],["","张三","80"]]) {
    assert.throws(()=>parseScores({headers:["学号","姓名","考试"],rows:[row]},students));
  }
});
test("拒绝负数、NaN、错误小数、重复行及重复表头", () => {
  for (const raw of ["-1","NaN","0x10","88,5","88.123","Infinity"]) {
    assert.throws(()=>parseScores({headers:["学号","姓名","考试"],rows:[["0012","张三",raw]]},students));
  }
  assert.throws(()=>parseScores({headers:["学号","姓名","考试","考试"],rows:[["0012","张三","80","90"]]},students));
  assert.throws(()=>parseScores({headers:["学号","姓名","考试"],rows:[["0012","张三","80"],["0012","张三","90"]]},students));
});
test("有数据的无名列不得静默忽略", () => {
  assert.throws(()=>parseScores({headers:["学号","姓名",""],rows:[["0012","张三","90"]]},students));
});
