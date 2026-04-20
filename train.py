import pickle
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score

data = pd.read_csv('training.csv', header=None)

X = data.iloc[:, 1:] # cols 1-64, coordinates 
y = data.iloc[:, 0] # col 0, label

x_train, x_test, y_train, y_test = train_test_split(X, y, test_size=0.2, shuffle=True, stratify=y)

model = RandomForestClassifier(n_estimators=100)

model.fit(x_train, y_train)

y_predict = model.predict(x_test)
score = accuracy_score(y_test, y_predict)

print(f"Accuracy {score * 100:.2f}% ")


with open('model.p', 'wb') as f:
    pickle.dump({'model': model}, f)
print("model.p saved")