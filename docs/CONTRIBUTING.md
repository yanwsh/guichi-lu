# 贡献流程 / Contribution flow

本仓库的 `main` 只接受 Pull Request。任何人不得直接向 `main` 推送。合并与删除分支只由仓库所有者（Admin）执行。

The required flow is linear. Do not skip a step, and do not land work by pushing to `main`.

## 必经流程 / Required flow

1. **产品经理写 PRD / Product Manager writes the PRD**  
   用需求文档写清目标、范围和不做的事，并给出可检查的验收标准。没有 PRD，不开始设计或实现。  
   State the goal, scope, non-goals, and acceptance criteria. No PRD, no design or implementation.

2. **工程师做设计 / Engineer designs**  
   工程师依据 PRD 写出方案：模块边界、数据与接口、风险与取舍。设计未对齐前不写功能代码。  
   The engineer writes the technical design from the PRD: module boundaries, data and interfaces, risks. Do not start feature code before that design is agreed.

3. **工程师在分支上实现 / Engineer implements on a branch**  
   从最新 `main` 拉出功能分支，只在该分支上提交并推送。禁止 `git push` 到 `main`，也禁止把提交直接合进本地 `main` 再推送。  
   Branch from up-to-date `main`, commit only on that branch, and push the branch. Never push to `main`.

4. **测试补充并运行测试 / Tester adds and runs tests**  
   测试按 PRD 的验收标准补充测试并实际跑通。失败则打回实现，不进入评审。  
   The tester adds tests for the PRD acceptance criteria and runs them. Failures go back to implementation; they do not enter review.

5. **工程师代码评审 / Engineer code review**  
   由另一名工程师审查该分支上的改动。评审意见未处理完，不请求合并。  
   A second engineer reviews the branch. Do not ask to merge while review comments are still open.

6. **管理员合并 PR 并删除分支 / Admin (repo owner) merges the PR and deletes the branch**  
   仅仓库所有者可以把 Pull Request 合并进 `main`，并在合并后删除该功能分支。其他人不得合并。  
   Only the repo owner merges the pull request into `main` and then deletes the feature branch. No one else merges.

## 禁止 / Never

- 不要直接向 `main` 推送（`git push origin main`）。Never push to `main`.
- 不要在本地把功能提交合进 `main` 再推送或强推。Do not merge feature commits into local `main` and push.
- 不要自行合并 Pull Request。Do not merge the pull request yourself.
- 不要在合并后留下功能分支。The admin deletes the branch after the merge.

## 建议命令 / Suggested commands

```bash
git checkout main
git pull origin main
git checkout -b cursor/<short-description>
# 实现、补测试、跑测试 / implement, add tests, run them
git push -u origin HEAD
# 打开指向 main 的 Pull Request，等待工程师评审与 Admin 合并
# Open a pull request into main. Wait for engineer review and an admin merge.
```
