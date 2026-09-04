# 主线

DFT生成标签：**DFT：数据集和标签生成器**

机器学习低成本预测有效质量窗口：**机器学习：核心预测方法；有效质量窗口：核心预测结果**

TRIM/MD把窗口翻译为工艺参数：**TRIM/MD：工艺翻译层**

TCAD评价候选工艺：**TCAD：机器学习引导工艺候选的器件级评价**





## Methods

1. Framework Overview
2. DFT Dataset and Effective-Mass Labels——简要说明1,035个结构、330个有效标签、M–Γ/M–K提取方法。收敛参数等细节可以压缩或移入补充材料。
3. Interpretable Machine-Learning Prediction——特征、模型、训练测试划分、评价指标。
4. Process Translation Using TRIM and MD——介绍TRIM与MD，此时读者已经知道它们是为了解决“预测浓度不能直接用于制造”的问题。
5. TCAD Device-Level Evaluation

## Results

1. Model Performance and Interpretability——先证明机器学习模型可信。
2. Predicted Low-Effective-Mass Windows——展示浓度、元素、替位位点和方向依赖性，这是全文最核心的预测结果。
3. Reverse Mapping to Implantation and Annealing Parameters——展示与候选P、N、As、Al相关的TRIM剖面、MD化学激活比例和最终 `(D,E,T)`。
4. Device-Level Evaluation of ML-Guided Process Candidate——展示TCAD器件性能

## 图片

- Fig. 1：完整框架
- Fig. 2：机器学习性能与可解释性
- Fig. 3：有效质量—浓度预测窗口
- Fig. 4：TRIM/MD工艺翻译与反向映射
- Fig. 5：TCAD器件结构
- Fig. 6–7：器件性能

当前Fig. 2中的全部元素TRIM曲线、7种初始间隙构型和完整温度网格可以移入补充材料。主文只保留与最终候选P、N、As、Al直接相关的证据。
